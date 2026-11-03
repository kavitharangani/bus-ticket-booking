import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { normalizePhone, validatePhone } from '../shared/booking-rules.js'
import { BookingError } from './bookings.js'

const MINUTE = 60000
const CODE_LIFETIME = 5 * MINUTE
const RESEND_WAIT = MINUTE
const MAX_ATTEMPTS = 5
const MAX_CODES_PER_PHONE_PER_HOUR = 5
const SESSION_LIFETIME = 30 * 24 * 60 * MINUTE

function sha256(text) {
  return createHash('sha256').update(text).digest()
}

function hashCode(phone, code) {
  return sha256(`${phone}:${code}`).toString('hex')
}

export function createAuthService(db, sms, { getNow = () => new Date(), maxCodesPerHour = 200 } = {}) {
  const deleteOldCodes = db.prepare('DELETE FROM otp_codes WHERE created_at < ?')
  const latestCode = db.prepare('SELECT * FROM otp_codes WHERE phone = ? ORDER BY id DESC LIMIT 1')
  const countForPhone = db.prepare('SELECT COUNT(*) AS total FROM otp_codes WHERE phone = ? AND created_at > ?')
  const countAll = db.prepare('SELECT COUNT(*) AS total FROM otp_codes WHERE created_at > ?')
  const insertCode = db.prepare('INSERT INTO otp_codes (phone, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
  const deleteCode = db.prepare('DELETE FROM otp_codes WHERE id = ?')
  const addAttempt = db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?')
  const markUsed = db.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?')
  const insertSession = db.prepare('INSERT INTO phone_sessions (token_hash, phone, expires_at) VALUES (?, ?, ?)')
  const selectSession = db.prepare('SELECT phone FROM phone_sessions WHERE token_hash = ? AND expires_at > ?')
  const deleteSession = db.prepare('DELETE FROM phone_sessions WHERE token_hash = ?')
  const deleteExpiredSessions = db.prepare('DELETE FROM phone_sessions WHERE expires_at <= ?')

  const issueCode = db.transaction((phone, codeHash, now) => {
    const hourAgo = now - 60 * MINUTE
    deleteOldCodes.run(now - 24 * 60 * MINUTE)
    const latest = latestCode.get(phone)
    if (latest && now - latest.created_at < RESEND_WAIT) {
      const resendInSeconds = Math.ceil((RESEND_WAIT - (now - latest.created_at)) / 1000)
      throw new BookingError(429, 'wait_for_code', { resendInSeconds })
    }
    if (countForPhone.get(phone, hourAgo).total >= MAX_CODES_PER_PHONE_PER_HOUR) {
      throw new BookingError(429, 'too_many_codes')
    }
    // A cap across all numbers limits the SMS bill if someone floods many different numbers.
    if (countAll.get(hourAgo).total >= maxCodesPerHour) {
      throw new BookingError(503, 'sms_paused')
    }
    if (latest && !latest.used_at) markUsed.run(now, latest.id)
    return insertCode.run(phone, codeHash, now, now + CODE_LIFETIME).lastInsertRowid
  })

  const countAttempt = db.transaction((phone, codeHash, now) => {
    const row = latestCode.get(phone)
    if (!row || row.used_at || row.expires_at <= now) return { status: 'expired' }
    if (row.attempts >= MAX_ATTEMPTS) return { status: 'locked' }
    addAttempt.run(row.id)
    const matches = timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(codeHash))
    if (matches) {
      markUsed.run(now, row.id)
      return { status: 'ok' }
    }
    return { status: 'wrong', attemptsLeft: MAX_ATTEMPTS - row.attempts - 1 }
  })

  return {
    async requestCode(rawPhone) {
      const invalid = validatePhone(rawPhone)
      if (invalid) throw new BookingError(400, invalid)
      const phone = normalizePhone(rawPhone)
      const code = String(randomInt(1000000)).padStart(6, '0')
      const id = issueCode.immediate(phone, hashCode(phone, code), getNow().getTime())
      try {
        await sms.send(phone, `Your BusLanka code is ${code}. It expires in 5 minutes. Do not share it.`)
      } catch (error) {
        deleteCode.run(id)
        console.error('Could not send SMS:', error.message)
        throw new BookingError(502, 'sms_failed')
      }
      return {
        expiresInSeconds: CODE_LIFETIME / 1000,
        resendInSeconds: RESEND_WAIT / 1000,
        ...(sms.exposesCode ? { devCode: code } : {}),
      }
    },

    verifyCode(rawPhone, rawCode) {
      const phone = normalizePhone(rawPhone)
      const code = String(rawCode ?? '').trim()
      if (validatePhone(phone) || !/^\d{6}$/.test(code)) {
        throw new BookingError(400, 'code_format')
      }
      const now = getNow().getTime()
      const result = countAttempt.immediate(phone, hashCode(phone, code), now)
      if (result.status === 'expired') throw new BookingError(400, 'code_expired')
      if (result.status === 'locked') throw new BookingError(429, 'code_locked')
      if (result.status === 'wrong') {
        throw new BookingError(400, 'code_wrong', { attemptsLeft: result.attemptsLeft })
      }

      deleteExpiredSessions.run(now)
      const token = randomBytes(32).toString('base64url')
      const expiresAt = now + SESSION_LIFETIME
      insertSession.run(sha256(token).toString('hex'), phone, expiresAt)
      return { token, phone, expiresAt }
    },

    phoneForToken(token) {
      return selectSession.get(sha256(token).toString('hex'), getNow().getTime())?.phone ?? null
    },

    endSession(token) {
      deleteSession.run(sha256(token).toString('hex'))
    },
  }
}
