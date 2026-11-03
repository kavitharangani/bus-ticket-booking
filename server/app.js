import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { createAuthService } from './auth.js'
import { BookingError, createBookingService } from './bookings.js'

function limiter(limit) {
  return rateLimit({
    windowMs: 60000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'too_many_requests' },
  })
}

function bearerToken(req) {
  const match = /^Bearer (\S+)$/.exec(req.get('authorization') ?? '')
  return match ? match[1] : null
}

export function createApp(db, { now, sms, maxCodesPerHour, payments = null } = {}) {
  const service = createBookingService(db, { getNow: now, onlinePayment: Boolean(payments) })
  const auth = createAuthService(db, sms, { getNow: now, maxCodesPerHour })
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '20kb' }))

  // Each code costs money to send, so this limit is much tighter than the others.
  const limitSms = limiter(10)
  const limitWrites = limiter(60)

  function requirePhone(req, res, next) {
    const token = bearerToken(req)
    req.phone = token && auth.phoneForToken(token)
    if (!req.phone) throw new BookingError(401, 'session_expired')
    next()
  }

  const api = express.Router()

  api.get('/health', (req, res) => {
    res.json({ ok: true })
  })

  api.get('/config', (req, res) => {
    res.json({ onlinePayment: Boolean(payments) })
  })

  api.post('/auth/otp/request', limitSms, async (req, res, next) => {
    try {
      res.json(await auth.requestCode(req.body?.phone))
    } catch (error) {
      next(error)
    }
  })

  api.post('/auth/otp/verify', limitWrites, (req, res) => {
    res.json(auth.verifyCode(req.body?.phone, req.body?.code))
  })

  api.post('/auth/logout', (req, res) => {
    const token = bearerToken(req)
    if (token) auth.endSession(token)
    res.json({ ok: true })
  })

  api.get('/availability', (req, res) => {
    res.json({ taken: service.availability(req.query.date) })
  })

  api.get('/trips/:tripId/seats', (req, res) => {
    res.json({ taken: service.takenSeats(req.params.tripId, req.query.date) })
  })

  api.post('/bookings', limitWrites, requirePhone, (req, res) => {
    res.status(201).json(service.create(req.body, req.phone))
  })

  api.get('/bookings', requirePhone, (req, res) => {
    res.json({ bookings: service.listForPhone(req.phone) })
  })

  api.get('/bookings/:ref', requirePhone, (req, res) => {
    res.json(service.getForPhone(req.params.ref, req.phone))
  })

  api.post('/bookings/:ref/cancel', limitWrites, requirePhone, (req, res) => {
    res.json(service.cancel(req.params.ref, req.phone))
  })

  api.post('/bookings/:ref/pay', limitWrites, requirePhone, (req, res) => {
    const { booking, orderId, email } = service.beginPayment(req.params.ref, req.phone)
    res.json(payments.checkout(booking, { orderId, email }))
  })

  // PayHere calls this directly from its servers, so the signature is the only proof of who sent it.
  if (payments?.parseNotification) {
    api.post('/payments/payhere/notify', express.urlencoded({ extended: false, limit: '20kb' }), (req, res) => {
      const notice = payments.parseNotification(req.body)
      if (!notice) {
        console.error('Rejected a payment notice with a bad signature.')
        return res.status(400).json({ error: 'invalid_request' })
      }
      service.applyPayment(notice)
      return res.json({ ok: true })
    })
  }

  // Stands in for the payment page. This route only exists in dev mode.
  if (payments?.isTest) {
    api.post('/payments/test/:ref', limitWrites, requirePhone, (req, res) => {
      const booking = service.getForPhone(req.params.ref, req.phone)
      service.applyPayment({
        orderId: booking.ref,
        amount: booking.total,
        currency: 'LKR',
        statusCode: req.body?.outcome === 'success' ? 2 : -2,
        paymentId: `test-${booking.ref}`,
      })
      res.json(service.getForPhone(req.params.ref, req.phone))
    })
  }

  api.use((req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  app.use('/api', api)

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    if (error instanceof BookingError) {
      return res.status(error.status).json({ error: error.code, ...error.details })
    }
    if (error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: 'invalid_request' })
    }
    console.error(error)
    return res.status(500).json({ error: 'server_error' })
  })

  return app
}
