import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleDemoRequest } from './demoApi.js'

const NOW = new Date(2026, 10, 10, 8, 0)
const DATE = '2026-11-11'
const PHONE = '0771234567'
const TRIP = 'r01-o-0600'
const BODY = { tripId: TRIP, date: DATE, from: 'Colombo Fort', to: 'Kandy', name: 'Test Passenger' }
const MINUTE = 60000

function call(path, body, token, now = NOW) {
  return handleDemoRequest(path, body, token, now)
}

function login(phone = PHONE) {
  const { devCode } = call('/auth/otp/request', { phone }).data
  return call('/auth/otp/verify', { phone, code: devCode }).data.token
}

function taken() {
  return call(`/trips/${TRIP}/seats?date=${DATE}`).data.taken
}

function freeSeats(count) {
  const used = new Set(taken())
  const free = []
  for (let seat = 1; free.length < count; seat++) if (!used.has(seat)) free.push(seat)
  return free
}

beforeEach(() => {
  const store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  })
})

describe('browser demo', () => {
  it('shows the same taken seats on every visit', () => {
    expect(taken().length).toBeGreaterThan(0)
    expect(taken()).toEqual(taken())
  })

  it('counts the same seats in availability', () => {
    expect(call(`/availability?date=${DATE}`).data.taken[TRIP]).toBe(taken().length)
  })

  it('needs a verified number to book or see tickets', () => {
    expect(call('/bookings', { ...BODY, seats: freeSeats(1) }).status).toBe(401)
    expect(call('/bookings').status).toBe(401)
    expect(call('/bookings', undefined, 'made-up').status).toBe(401)
  })

  it('checks codes as the server does', () => {
    expect(call('/auth/otp/request', { phone: '123' }).data.error).toBe('phone_invalid')
    const { devCode } = call('/auth/otp/request', { phone: PHONE }).data
    expect(devCode).toMatch(/^\d{6}$/)
    expect(call('/auth/otp/request', { phone: PHONE }).data.error).toBe('wait_for_code')
    const wrong = devCode === '000000' ? '000001' : '000000'
    expect(call('/auth/otp/verify', { phone: PHONE, code: wrong }).data).toEqual({ error: 'code_wrong', attemptsLeft: 4 })
    expect(call('/auth/otp/verify', { phone: PHONE, code: devCode }).status).toBe(200)
    expect(call('/auth/otp/verify', { phone: PHONE, code: devCode }).data.error).toBe('code_expired')
  })

  it('books, blocks a taken seat, and frees it on cancel', () => {
    const token = login()
    const [seat] = freeSeats(1)
    const response = call('/bookings', { ...BODY, seats: [seat] }, token)
    expect(response.status).toBe(201)
    expect(response.data.passenger.phone).toBe(PHONE)
    expect(response.data.payment.status).toBe('pay_on_board')
    expect(taken()).toContain(seat)
    expect(call('/bookings', { ...BODY, seats: [seat] }, token).data).toEqual({ error: 'seat_taken', conflicts: [seat] })
    expect(call(`/bookings/${response.data.ref}/cancel`, {}, token).data.status).toBe('cancelled')
    expect(taken()).not.toContain(seat)
  })

  it('rejects bad bookings with translatable codes', () => {
    const token = login()
    const seats = freeSeats(1)
    expect(call('/bookings', { ...BODY, tripId: 'nope', seats }, token).data.error).toBe('bus_not_found')
    expect(call('/bookings', { ...BODY, date: '2026-11-09', seats }, token).data.error).toBe('date_out_of_range')
    expect(call('/bookings', { ...BODY, from: 'Kandy', to: 'Colombo Fort', seats }, token).data.error).toBe('wrong_stops')
    expect(call('/bookings', { ...BODY, seats: [999] }, token).data.error).toBe('invalid_seats')
    expect(call('/bookings', { ...BODY, name: ' ', seats }, token).data.fields).toEqual({ name: 'name_required' })
    expect(call('/bookings', { ...BODY, date: '2026-11-10', tripId: 'r01-o-0500', seats }, token).data.error).toBe('booking_closed')
  })

  it('limits one number to five seats on a bus', () => {
    const token = login()
    const seats = freeSeats(6)
    expect(call('/bookings', { ...BODY, seats: seats.slice(0, 5) }, token).status).toBe(201)
    expect(call('/bookings', { ...BODY, seats: seats.slice(5) }, token).data.error).toBe('seat_limit')
  })

  it('runs the test payment flow, including a refund after cancelling', () => {
    const token = login()
    const { data: booking } = call('/bookings', { ...BODY, seats: freeSeats(1), paymentMethod: 'online', email: 'test@example.com' }, token)
    expect(booking.payment).toEqual({ status: 'awaiting', expiresAt: NOW.getTime() + 15 * MINUTE })
    expect(call(`/bookings/${booking.ref}/pay`, {}, token).data).toEqual({ testUrl: `/pay/test/${booking.ref}` })
    expect(call(`/payments/test/${booking.ref}`, { outcome: 'fail' }, token).data.payment.status).toBe('awaiting')
    expect(call(`/payments/test/${booking.ref}`, { outcome: 'success' }, token).data.payment.status).toBe('paid')
    expect(call(`/bookings/${booking.ref}/pay`, {}, token).data.error).toBe('not_awaiting_payment')
    expect(call(`/bookings/${booking.ref}/cancel`, {}, token).data.payment.status).toBe('refund_due')
  })

  it('releases unpaid seats after 15 minutes', () => {
    const token = login()
    const [seat] = freeSeats(1)
    const { data: booking } = call('/bookings', { ...BODY, seats: [seat], paymentMethod: 'online', email: 'test@example.com' }, token)
    const later = new Date(NOW.getTime() + 15 * MINUTE)
    const expired = call(`/bookings/${booking.ref}`, undefined, token, later).data
    expect(expired.status).toBe('cancelled')
    expect(expired.payment.status).toBe('expired')
    expect(taken()).not.toContain(seat)
  })

  it('keeps tickets separate per number, and ends sessions on logout', () => {
    const owner = login()
    const { data: booking } = call('/bookings', { ...BODY, seats: freeSeats(1) }, owner)
    const other = login('0712345678')
    expect(call(`/bookings/${booking.ref}`, undefined, other).status).toBe(404)
    expect(call('/bookings', undefined, other).data.bookings).toEqual([])
    expect(call('/bookings', undefined, owner).data.bookings).toHaveLength(1)
    call('/auth/logout', {}, owner)
    expect(call('/bookings', undefined, owner).status).toBe(401)
  })
})
