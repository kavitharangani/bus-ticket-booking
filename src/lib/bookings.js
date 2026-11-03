import { hasTranslation, translate } from '../i18n/index.js'
import { getSession, setSession } from './session.js'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

function errorMessage(data) {
  const key = `errors.${data?.error}`
  if (!hasTranslation(key)) return translate('errors.server_error')
  return translate(key, { ...data, seats: data.conflicts?.join(', ') })
}

async function request(path, body) {
  const token = getSession()?.token
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }
  let response
  try {
    response = await fetch(`/api${path}`, body === undefined
      ? { headers }
      : { method: 'POST', headers, body: JSON.stringify(body) })
  } catch {
    throw new ApiError(translate('errors.no_connection'), 0)
  }
  const data = await response.json().catch(() => null)
  // Only drop the session if this request used it, in case a newer one started meanwhile.
  if (response.status === 401 && token && getSession()?.token === token) setSession(null)
  if (!response.ok || data === null) throw new ApiError(errorMessage(data), response.status, data)
  return data
}

export function fetchConfig() {
  return request('/config')
}

export function requestOtp(phone) {
  return request('/auth/otp/request', { phone })
}

export async function verifyOtp(phone, code) {
  setSession(await request('/auth/otp/verify', { phone, code }))
}

export function signOut() {
  // Forget the session here first, so this device is signed out even if the server can't be reached.
  const token = getSession()?.token
  setSession(null)
  if (token) {
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
  }
}

export async function fetchTakenSeats(tripId, date) {
  const { taken } = await request(`/trips/${encodeURIComponent(tripId)}/seats?date=${encodeURIComponent(date)}`)
  return new Set(taken)
}

export async function fetchAvailability(date) {
  const { taken } = await request(`/availability?date=${encodeURIComponent(date)}`)
  return taken
}

export function createBooking(details) {
  return request('/bookings', details)
}

export async function fetchMyBookings() {
  const { bookings } = await request('/bookings')
  return bookings
}

export async function fetchBooking(ref) {
  try {
    return await request(`/bookings/${encodeURIComponent(ref)}`)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

export function cancelBooking(ref) {
  return request(`/bookings/${encodeURIComponent(ref)}/cancel`, {})
}

export function simulateTestPayment(ref, outcome) {
  return request(`/payments/test/${encodeURIComponent(ref)}`, { outcome })
}

// Sends the passenger to the payment page. PayHere needs a form post rather than a link.
export async function startPayment(ref, navigate) {
  const checkout = await request(`/bookings/${encodeURIComponent(ref)}/pay`, {})
  if (checkout.testUrl) {
    navigate(checkout.testUrl, { replace: true })
    return
  }
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = checkout.action
  for (const [name, value] of Object.entries(checkout.fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}

// Rows of 2 + aisle + 2, with a five-seat bench across the back.
export function buildSeatRows(total) {
  const rows = []
  let seat = 1
  while (seat <= total - 5) {
    rows.push([seat, seat + 1, null, seat + 2, seat + 3])
    seat += 4
  }
  rows.push([seat, seat + 1, seat + 2, seat + 3, seat + 4])
  return rows
}
