import { randomInt } from 'node:crypto'
import { BUS_CLASSES, getSegment, getTrip } from '../shared/routes.js'
import { MAX_ADVANCE_DAYS, MAX_SEATS, PAYMENT_HOLD_MINUTES, validateEmail, validateName } from '../shared/booking-rules.js'
import { addDays, parseDateStr, toDateStr } from '../shared/util.js'

const REF_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const PAYHERE_SUCCESS = 2
const PAYHERE_CHARGEBACK = -3

// `code` is translated by the app, so the server never has to know the visitor's language.
export class BookingError extends Error {
  constructor(status, code, details = {}) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

function toBooking(row) {
  return {
    ref: row.ref,
    tripId: row.trip_id,
    date: row.travel_date,
    from: row.from_stop,
    to: row.to_stop,
    seats: JSON.parse(row.seats),
    passenger: { name: row.passenger_name, phone: row.passenger_phone },
    total: row.total,
    status: row.status,
    payment: { status: row.payment_status, expiresAt: row.payment_expires_at },
    createdAt: row.created_at,
  }
}

function isBookableDate(date, now) {
  if (!parseDateStr(date)) return false
  return date >= toDateStr(now) && date <= toDateStr(addDays(now, MAX_ADVANCE_DAYS))
}

export function createBookingService(db, { getNow = () => new Date(), onlinePayment = false } = {}) {
  const selectTaken = db.prepare('SELECT seat FROM seat_holds WHERE trip_id = ? AND travel_date = ? ORDER BY seat')
  const selectCounts = db.prepare('SELECT trip_id AS tripId, COUNT(*) AS taken FROM seat_holds WHERE travel_date = ? GROUP BY trip_id')
  const selectBooking = db.prepare('SELECT * FROM bookings WHERE ref = ?')
  const selectByPhone = db.prepare('SELECT * FROM bookings WHERE passenger_phone = ? ORDER BY created_at DESC LIMIT 100')
  const countHeldByPhone = db.prepare(`
    SELECT COUNT(*) AS total FROM seat_holds
    JOIN bookings ON bookings.ref = seat_holds.booking_ref
    WHERE seat_holds.trip_id = ? AND seat_holds.travel_date = ? AND bookings.passenger_phone = ?
  `)
  const insertBooking = db.prepare(`
    INSERT INTO bookings (ref, trip_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_phone, total, status, created_at, payment_status, payment_expires_at, payment_email)
    VALUES (@ref, @tripId, @date, @from, @to, @seats, @name, @phone, @total, 'confirmed', @createdAt, @paymentStatus, @paymentExpiresAt, @paymentEmail)
  `)
  const insertHold = db.prepare('INSERT INTO seat_holds (trip_id, travel_date, seat, booking_ref) VALUES (?, ?, ?, ?)')
  const deleteHolds = db.prepare('DELETE FROM seat_holds WHERE booking_ref = ?')
  const markCancelled = db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, payment_status = ? WHERE ref = ?")
  const selectExpired = db.prepare("SELECT ref FROM bookings WHERE status = 'confirmed' AND payment_status = 'awaiting' AND payment_expires_at <= ?")
  const addAttempt = db.prepare('UPDATE bookings SET payment_attempts = payment_attempts + 1 WHERE ref = ?')
  const markPaid = db.prepare("UPDATE bookings SET status = 'confirmed', cancelled_at = NULL, payment_status = 'paid', payment_id = ?, paid_at = ?, payment_expires_at = NULL WHERE ref = ?")
  const markRefundDue = db.prepare("UPDATE bookings SET payment_status = 'refund_due', payment_id = ?, paid_at = ? WHERE ref = ?")

  function newRef() {
    let ref
    do {
      ref = 'BL'
      for (let i = 0; i < 6; i++) ref += REF_LETTERS[randomInt(REF_LETTERS.length)]
    } while (selectBooking.get(ref))
    return ref
  }

  function seatsAreFree(row) {
    const taken = new Set(selectTaken.all(row.trip_id, row.travel_date).map((item) => item.seat))
    return JSON.parse(row.seats).every((seat) => !taken.has(seat))
  }

  const release = db.transaction((ref, cancelledAt, paymentStatus) => {
    deleteHolds.run(ref)
    markCancelled.run(cancelledAt, paymentStatus, ref)
  })

  // Runs before anything reads seats, so unpaid holds never block other passengers past their time.
  function releaseExpired() {
    const now = getNow()
    for (const { ref } of selectExpired.all(now.getTime())) release(ref, now.toISOString(), 'expired')
  }

  // IMMEDIATE takes the write lock first, so two requests can't both see a seat as free.
  const reserve = db.transaction((input) => {
    const taken = new Set(selectTaken.all(input.tripId, input.date).map((row) => row.seat))
    const conflicts = input.seatList.filter((seat) => taken.has(seat))
    if (conflicts.length > 0) throw new BookingError(409, 'seat_taken', { conflicts })
    const held = countHeldByPhone.get(input.tripId, input.date, input.phone).total
    if (held + input.seatList.length > MAX_SEATS) throw new BookingError(409, 'seat_limit', { max: MAX_SEATS, held })
    const ref = newRef()
    insertBooking.run({ ...input, ref })
    input.seatList.forEach((seat) => insertHold.run(input.tripId, input.date, seat, ref))
    return ref
  })

  const recordPayment = db.transaction(({ row, paymentId, nowIso, departed }) => {
    if (row.payment_status === 'paid' || row.payment_status === 'refund_due') return
    if (row.status === 'confirmed' && row.payment_status === 'awaiting') {
      markPaid.run(paymentId, nowIso, row.ref)
      return
    }
    // The money arrived after the hold ended. Give the seats back if nobody else has taken them.
    if (row.payment_status === 'expired' && !departed && seatsAreFree(row)) {
      JSON.parse(row.seats).forEach((seat) => insertHold.run(row.trip_id, row.travel_date, seat, row.ref))
      markPaid.run(paymentId, nowIso, row.ref)
      return
    }
    markRefundDue.run(paymentId, nowIso, row.ref)
    console.warn(`Refund needed: booking ${row.ref} was paid after it ended (payment ${paymentId}).`)
  })

  function findOwned(ref, phone) {
    const row = selectBooking.get(ref.trim().toUpperCase())
    return row && row.passenger_phone === phone ? row : null
  }

  return {
    takenSeats(tripId, date) {
      if (!getTrip(tripId)) throw new BookingError(404, 'bus_not_found')
      if (!parseDateStr(date)) throw new BookingError(400, 'invalid_date')
      releaseExpired()
      return selectTaken.all(tripId, date).map((row) => row.seat)
    },

    availability(date) {
      if (!parseDateStr(date)) throw new BookingError(400, 'invalid_date')
      releaseExpired()
      return Object.fromEntries(selectCounts.all(date).map((row) => [row.tripId, row.taken]))
    },

    // `phone` always comes from the verified session, never from the request body.
    create(body, phone) {
      const { tripId, date, from, to, seats, name, paymentMethod = 'board', email } = body ?? {}
      const now = getNow()
      const trip = getTrip(tripId)
      if (!trip) throw new BookingError(404, 'bus_not_found')
      if (!isBookableDate(date, now)) throw new BookingError(400, 'date_out_of_range', { days: MAX_ADVANCE_DAYS })
      const segment = getSegment(trip, from, to, date)
      if (!segment) throw new BookingError(400, 'wrong_stops')
      if (segment.departAt <= now) throw new BookingError(409, 'booking_closed')

      const total = BUS_CLASSES[trip.cls].seats
      const validSeats =
        Array.isArray(seats) &&
        seats.length >= 1 &&
        seats.length <= MAX_SEATS &&
        new Set(seats).size === seats.length &&
        seats.every((seat) => Number.isInteger(seat) && seat >= 1 && seat <= total)
      if (!validSeats) throw new BookingError(400, 'invalid_seats', { max: MAX_SEATS })

      const nameError = validateName(name)
      if (nameError) throw new BookingError(400, nameError, { fields: { name: nameError } })

      if (paymentMethod !== 'board' && paymentMethod !== 'online') throw new BookingError(400, 'invalid_request')
      const online = paymentMethod === 'online'
      if (online && !onlinePayment) throw new BookingError(503, 'payment_unavailable')
      if (online && validateEmail(email)) throw new BookingError(400, 'email_invalid', { fields: { email: 'email_invalid' } })

      releaseExpired()
      const seatList = [...seats].sort((a, b) => a - b)
      const ref = reserve.immediate({
        tripId,
        date,
        from,
        to,
        seatList,
        seats: JSON.stringify(seatList),
        name: name.trim(),
        phone,
        total: segment.fare * seatList.length,
        createdAt: now.toISOString(),
        paymentStatus: online ? 'awaiting' : 'pay_on_board',
        // Never hold past departure, because nobody can pay for a bus that has left.
        paymentExpiresAt: online ? Math.min(now.getTime() + PAYMENT_HOLD_MINUTES * 60000, segment.departAt.getTime()) : null,
        paymentEmail: online ? email.trim() : null,
      })
      return toBooking(selectBooking.get(ref))
    },

    listForPhone(phone) {
      releaseExpired()
      return selectByPhone.all(phone).map(toBooking)
    },

    getForPhone(ref, phone) {
      releaseExpired()
      const row = findOwned(ref, phone)
      if (!row) throw new BookingError(404, 'ticket_not_found')
      return toBooking(row)
    },

    cancel(ref, phone) {
      releaseExpired()
      const row = findOwned(ref, phone)
      if (!row) throw new BookingError(404, 'ticket_not_found')
      if (row.status === 'cancelled') return toBooking(row)
      const now = getNow()
      const segment = getSegment(getTrip(row.trip_id), row.from_stop, row.to_stop, row.travel_date)
      if (segment.departAt <= now) throw new BookingError(409, 'already_left')
      const paymentStatus = { paid: 'refund_due', awaiting: 'not_paid' }[row.payment_status] ?? row.payment_status
      release.immediate(row.ref, now.toISOString(), paymentStatus)
      if (paymentStatus === 'refund_due') console.warn(`Refund needed: paid booking ${row.ref} was cancelled (payment ${row.payment_id}).`)
      return toBooking(selectBooking.get(row.ref))
    },

    // Each attempt gets its own order ID, because PayHere doesn't document reusing one.
    beginPayment(ref, phone) {
      if (!onlinePayment) throw new BookingError(503, 'payment_unavailable')
      releaseExpired()
      const row = findOwned(ref, phone)
      if (!row) throw new BookingError(404, 'ticket_not_found')
      if (row.status !== 'confirmed' || row.payment_status !== 'awaiting') throw new BookingError(409, 'not_awaiting_payment')
      addAttempt.run(row.ref)
      return { booking: toBooking(row), orderId: `${row.ref}-${row.payment_attempts + 1}`, email: row.payment_email }
    },

    applyPayment({ orderId, amount, currency, statusCode, paymentId }) {
      releaseExpired()
      const row = selectBooking.get(String(orderId).split('-')[0])
      if (!row) {
        console.error(`Payment notice for unknown order ${orderId}.`)
        return
      }
      if (amount !== row.total || currency !== 'LKR') {
        console.error(`Payment notice for ${row.ref} has the wrong amount: ${amount} ${currency}.`)
        return
      }
      const now = getNow()
      if (statusCode === PAYHERE_SUCCESS) {
        const departed = getSegment(getTrip(row.trip_id), row.from_stop, row.to_stop, row.travel_date).departAt <= now
        recordPayment.immediate({ row, paymentId, nowIso: now.toISOString(), departed })
      } else if (statusCode === PAYHERE_CHARGEBACK && row.status === 'confirmed') {
        release.immediate(row.ref, now.toISOString(), 'chargedback')
        console.warn(`Chargeback: booking ${row.ref} was cancelled (payment ${paymentId}).`)
      }
    },
  }
}
