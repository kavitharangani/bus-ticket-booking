import { BUS_CLASSES, TRIPS, getSegment, getTrip } from '../../shared/routes.js'
import { MAX_ADVANCE_DAYS, MAX_SEATS, PAYMENT_HOLD_MINUTES, normalizePhone, validateEmail, validateName, validatePhone } from '../../shared/booking-rules.js'
import { addDays, hashString, parseDateStr, seededRandom, toDateStr } from '../../shared/util.js'

// Stands in for the server on static hosting such as GitHub Pages, with the same routes and error codes.
// Everything is kept in this browser, so one visitor's bookings are never seen by another.
const STORAGE_KEY = 'buslanka.demo'
const REF_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const MINUTE = 60000
const CODE_LIFETIME = 5 * MINUTE
const RESEND_WAIT = MINUTE
const MAX_ATTEMPTS = 5
const SESSION_LIFETIME = 30 * 24 * 60 * MINUTE

class BookingError extends Error {
  constructor(status, code, details = {}) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (stored?.bookings) return stored
  } catch {
    // Falls through to an empty demo.
  }
  return { bookings: [], codes: {}, sessions: {} }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // The demo still answers this request, but won't remember it.
  }
}

// Other passengers don't exist in this demo, so each bus shows the same few seats as taken.
function seatsOfOthers(trip, date) {
  const random = seededRandom(hashString(`seats|${trip.id}|${date}`))
  const fillRate = 0.15 + random() * 0.3
  const taken = []
  for (let seat = 1; seat <= BUS_CLASSES[trip.cls].seats; seat++) {
    if (random() < fillRate) taken.push(seat)
  }
  return taken
}

function takenSeats(state, trip, date) {
  const mine = state.bookings
    .filter((booking) => booking.tripId === trip.id && booking.date === date && booking.status === 'confirmed')
    .flatMap((booking) => booking.seats)
  return [...new Set([...seatsOfOthers(trip, date), ...mine])].sort((a, b) => a - b)
}

function releaseExpired(state, now) {
  for (const booking of state.bookings) {
    if (booking.status === 'confirmed' && booking.payment.status === 'awaiting' && booking.payment.expiresAt <= now.getTime()) {
      booking.status = 'cancelled'
      booking.payment.status = 'expired'
    }
  }
}

function newRef(state) {
  let ref
  do {
    ref = 'BL'
    for (let i = 0; i < 6; i++) ref += REF_LETTERS[Math.floor(Math.random() * REF_LETTERS.length)]
  } while (state.bookings.some((booking) => booking.ref === ref))
  return ref
}

function requestCode(state, body, now) {
  if (validatePhone(body?.phone)) throw new BookingError(400, 'phone_invalid')
  const phone = normalizePhone(body.phone)
  const latest = state.codes[phone]
  if (latest && now.getTime() - latest.createdAt < RESEND_WAIT) {
    const resendInSeconds = Math.ceil((RESEND_WAIT - (now.getTime() - latest.createdAt)) / 1000)
    throw new BookingError(429, 'wait_for_code', { resendInSeconds })
  }
  const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
  state.codes[phone] = { code, createdAt: now.getTime(), expiresAt: now.getTime() + CODE_LIFETIME, attempts: 0 }
  return { expiresInSeconds: CODE_LIFETIME / 1000, resendInSeconds: RESEND_WAIT / 1000, devCode: code }
}

function verifyCode(state, body, now) {
  const phone = normalizePhone(body?.phone)
  const code = String(body?.code ?? '').trim()
  if (validatePhone(phone) || !/^\d{6}$/.test(code)) throw new BookingError(400, 'code_format')
  const entry = state.codes[phone]
  if (!entry || entry.used || entry.expiresAt <= now.getTime()) throw new BookingError(400, 'code_expired')
  if (entry.attempts >= MAX_ATTEMPTS) throw new BookingError(429, 'code_locked')
  entry.attempts += 1
  if (entry.code !== code) throw new BookingError(400, 'code_wrong', { attemptsLeft: MAX_ATTEMPTS - entry.attempts })
  entry.used = true
  const token = `demo-${newRef(state)}-${now.getTime()}`
  const expiresAt = now.getTime() + SESSION_LIFETIME
  state.sessions[token] = { phone, expiresAt }
  return { token, phone, expiresAt }
}

function createBooking(state, body, phone, now) {
  const { tripId, date, from, to, seats, name, paymentMethod = 'board', email } = body ?? {}
  const trip = getTrip(tripId)
  if (!trip) throw new BookingError(404, 'bus_not_found')
  const inRange = parseDateStr(date) && date >= toDateStr(now) && date <= toDateStr(addDays(now, MAX_ADVANCE_DAYS))
  if (!inRange) throw new BookingError(400, 'date_out_of_range', { days: MAX_ADVANCE_DAYS })
  const segment = getSegment(trip, from, to, date)
  if (!segment) throw new BookingError(400, 'wrong_stops')
  if (segment.departAt <= now) throw new BookingError(409, 'booking_closed')

  const validSeats =
    Array.isArray(seats) &&
    seats.length >= 1 &&
    seats.length <= MAX_SEATS &&
    new Set(seats).size === seats.length &&
    seats.every((seat) => Number.isInteger(seat) && seat >= 1 && seat <= BUS_CLASSES[trip.cls].seats)
  if (!validSeats) throw new BookingError(400, 'invalid_seats', { max: MAX_SEATS })

  const nameError = validateName(name)
  if (nameError) throw new BookingError(400, nameError, { fields: { name: nameError } })
  const online = paymentMethod === 'online'
  if (online && validateEmail(email)) throw new BookingError(400, 'email_invalid', { fields: { email: 'email_invalid' } })

  const taken = new Set(takenSeats(state, trip, date))
  const conflicts = seats.filter((seat) => taken.has(seat))
  if (conflicts.length > 0) throw new BookingError(409, 'seat_taken', { conflicts })
  const held = state.bookings
    .filter((item) => item.tripId === tripId && item.date === date && item.status === 'confirmed' && item.passenger.phone === phone)
    .reduce((count, item) => count + item.seats.length, 0)
  if (held + seats.length > MAX_SEATS) throw new BookingError(409, 'seat_limit', { max: MAX_SEATS, held })

  const booking = {
    ref: newRef(state),
    tripId,
    date,
    from,
    to,
    seats: [...seats].sort((a, b) => a - b),
    passenger: { name: name.trim(), phone },
    total: segment.fare * seats.length,
    status: 'confirmed',
    payment: {
      status: online ? 'awaiting' : 'pay_on_board',
      expiresAt: online ? Math.min(now.getTime() + PAYMENT_HOLD_MINUTES * MINUTE, segment.departAt.getTime()) : null,
    },
    createdAt: now.toISOString(),
  }
  state.bookings.push(booking)
  return booking
}

function ownedBooking(state, ref, phone) {
  const booking = state.bookings.find((item) => item.ref === ref.trim().toUpperCase() && item.passenger.phone === phone)
  if (!booking) throw new BookingError(404, 'ticket_not_found')
  return booking
}

function cancelBooking(booking, now) {
  if (booking.status === 'cancelled') return booking
  const segment = getSegment(getTrip(booking.tripId), booking.from, booking.to, booking.date)
  if (segment.departAt <= now) throw new BookingError(409, 'already_left')
  booking.status = 'cancelled'
  booking.payment.status = { paid: 'refund_due', awaiting: 'not_paid' }[booking.payment.status] ?? booking.payment.status
  return booking
}

function route(state, method, url, body, token, now) {
  const path = url.pathname
  const date = url.searchParams.get('date')

  if (method === 'GET' && path === '/config') return { onlinePayment: true }
  if (method === 'POST' && path === '/auth/otp/request') return requestCode(state, body, now)
  if (method === 'POST' && path === '/auth/otp/verify') return verifyCode(state, body, now)
  if (method === 'POST' && path === '/auth/logout') {
    delete state.sessions[token]
    return { ok: true }
  }

  if (method === 'GET' && path === '/availability') {
    if (!parseDateStr(date)) throw new BookingError(400, 'invalid_date')
    return { taken: Object.fromEntries(TRIPS.map((trip) => [trip.id, takenSeats(state, trip, date).length])) }
  }

  const seatsMatch = /^\/trips\/([^/]+)\/seats$/.exec(path)
  if (method === 'GET' && seatsMatch) {
    const trip = getTrip(decodeURIComponent(seatsMatch[1]))
    if (!trip) throw new BookingError(404, 'bus_not_found')
    if (!parseDateStr(date)) throw new BookingError(400, 'invalid_date')
    return { taken: takenSeats(state, trip, date) }
  }

  // Everything below belongs to one verified phone number.
  const session = state.sessions[token]
  if (!session || session.expiresAt <= now.getTime()) throw new BookingError(401, 'session_expired')
  const { phone } = session

  if (path === '/bookings') {
    if (method === 'POST') return createBooking(state, body, phone, now)
    return { bookings: state.bookings.filter((item) => item.passenger.phone === phone).reverse() }
  }

  const ticketMatch = /^\/bookings\/([^/]+)(?:\/(cancel|pay))?$/.exec(path)
  if (ticketMatch) {
    const booking = ownedBooking(state, decodeURIComponent(ticketMatch[1]), phone)
    if (ticketMatch[2] === 'cancel') return cancelBooking(booking, now)
    if (ticketMatch[2] === 'pay') {
      if (booking.status !== 'confirmed' || booking.payment.status !== 'awaiting') throw new BookingError(409, 'not_awaiting_payment')
      return { testUrl: `/pay/test/${booking.ref}` }
    }
    return booking
  }

  const paymentMatch = /^\/payments\/test\/([^/]+)$/.exec(path)
  if (method === 'POST' && paymentMatch) {
    const booking = ownedBooking(state, decodeURIComponent(paymentMatch[1]), phone)
    if (body?.outcome === 'success' && booking.status === 'confirmed' && booking.payment.status === 'awaiting') {
      booking.payment = { status: 'paid', expiresAt: null }
    }
    return booking
  }

  throw new BookingError(404, 'not_found')
}

export function handleDemoRequest(path, body, token, now = new Date()) {
  const state = loadState()
  releaseExpired(state, now)
  try {
    const method = body === undefined ? 'GET' : 'POST'
    const data = route(state, method, new URL(path, 'https://demo.invalid'), body, token, now)
    saveState(state)
    // A copy, so the page can never change stored data by accident.
    return { status: method === 'POST' && path === '/bookings' ? 201 : 200, data: JSON.parse(JSON.stringify(data)) }
  } catch (error) {
    if (!(error instanceof BookingError)) throw error
    // Failed attempts still count, and expired holds stay released.
    saveState(state)
    return { status: error.status, data: { error: error.code, ...error.details } }
  }
}
