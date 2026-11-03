import { useState } from 'react'
import { validatePhone } from '../../shared/booking-rules.js'
import { useT } from '../i18n/index.js'
import { requestOtp, verifyOtp } from '../lib/bookings.js'
import { useNow } from '../lib/useNow.js'

function onEnter(action) {
  return (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      action()
    }
  }
}

// Uses plain buttons rather than a form, because it sits inside the booking form.
export default function PhoneVerify() {
  const t = useT()
  const now = useNow(1000)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [devCode, setDevCode] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000))

  async function sendCode() {
    if (busy) return
    const invalid = validatePhone(phone)
    setError(invalid ? t(`errors.${invalid}`) : '')
    if (invalid) return
    setBusy(true)
    try {
      const result = await requestOtp(phone)
      setCodeSent(true)
      setCode('')
      setDevCode(result.devCode ?? '')
      setResendAt(Date.now() + result.resendInSeconds * 1000)
    } catch (failure) {
      setError(failure.message)
      // A code sent moments ago is still good, for example after reloading the page.
      if (failure.data?.resendInSeconds) {
        setCodeSent(true)
        setResendAt(Date.now() + failure.data.resendInSeconds * 1000)
      }
    } finally {
      setBusy(false)
    }
  }

  async function checkCode() {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await verifyOtp(phone, code)
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
    }
  }

  function changeNumber() {
    setCodeSent(false)
    setCode('')
    setDevCode('')
    setError('')
  }

  if (!codeSent) {
    return (
      <div className="phone-verify">
        <label className="field">
          <span>{t('verify.mobile')}</span>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            autoComplete="tel"
            placeholder="0771234567"
            aria-invalid={Boolean(error)}
            onChange={(event) => setPhone(event.target.value)}
            onKeyDown={onEnter(sendCode)}
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={sendCode}>
          {busy ? t('verify.sending') : t('verify.send')}
        </button>
      </div>
    )
  }

  return (
    <div className="phone-verify">
      <p className="small" role="status">
        {t('verify.sentTo')} <strong>{phone}</strong>{' '}
        <button type="button" className="link-btn" onClick={changeNumber}>{t('verify.change')}</button>
      </p>
      {devCode && <p className="dev-code">{t('verify.devCode')} <strong>{devCode}</strong></p>}
      <label className="field">
        <span>{t('verify.code')}</span>
        <input
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-invalid={Boolean(error)}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          onKeyDown={onEnter(checkCode)}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="trip-buttons">
        <button type="button" className="btn btn-ghost" disabled={busy || code.length !== 6} onClick={checkCode}>
          {busy ? t('verify.checking') : t('verify.check')}
        </button>
        <button type="button" className="link-btn" disabled={busy || resendIn > 0} onClick={sendCode}>
          {resendIn > 0 ? t('verify.resendIn', { n: resendIn }) : t('verify.resend')}
        </button>
      </div>
    </div>
  )
}
