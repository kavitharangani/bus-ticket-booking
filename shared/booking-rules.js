// Used by the form for quick feedback and by the server, which has the final say.
// Validators return an error code for the app to translate, or '' when the value is fine.
export const MAX_SEATS = 5
export const MAX_ADVANCE_DAYS = 30
export const PAYMENT_HOLD_MINUTES = 15

export function normalizePhone(phone) {
  return String(phone ?? '').replace(/[\s-]/g, '')
}

export function validatePhone(phone) {
  return /^07\d{8}$/.test(normalizePhone(phone)) ? '' : 'phone_invalid'
}

export function validateName(name) {
  const trimmed = String(name ?? '').trim()
  if (trimmed.length < 2) return 'name_required'
  if (trimmed.length > 80) return 'name_too_long'
  return ''
}

export function validateEmail(email) {
  const trimmed = String(email ?? '').trim()
  return trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? '' : 'email_invalid'
}
