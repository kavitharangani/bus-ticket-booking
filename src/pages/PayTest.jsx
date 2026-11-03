import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import LoadError from '../components/LoadError.jsx'
import { fmtMoney, useT } from '../i18n/index.js'
import { fetchBooking, simulateTestPayment } from '../lib/bookings.js'
import { useLoad } from '../lib/useLoad.js'

// Stands in for the PayHere page in dev mode. The server has no route behind it in production.
export default function PayTest() {
  const t = useT()
  const { ref } = useParams()
  const navigate = useNavigate()
  const { data: booking, error, reload } = useLoad(() => fetchBooking(ref), [ref])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  if (error && !booking) return <LoadError error={error} onRetry={reload} />
  if (!booking) return null

  async function finish(outcome) {
    setBusy(true)
    setFailure('')
    try {
      await simulateTestPayment(ref, outcome)
      if (outcome === 'success') {
        navigate(`/tickets/${ref}`, { replace: true })
        return
      }
      setFailure(t('payTest.failed'))
    } catch (problem) {
      setFailure(problem.message)
    }
    setBusy(false)
  }

  return (
    <section className="panel narrow-panel">
      <h1 className="page-title">{t('payTest.title')}</h1>
      <p className="dev-code">{t('payTest.text')}</p>
      <p><strong>{booking.ref}</strong> · {t('payTest.amount', { amount: fmtMoney(booking.total) })}</p>
      {failure && <p className="error" role="alert">{failure}</p>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => finish('success')}>{t('payTest.success')}</button>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => finish('fail')}>{t('payTest.fail')}</button>
      {failure && <button type="button" className="link-btn" onClick={() => navigate(`/tickets/${ref}`, { replace: true })}>{t('common.backToTickets')}</button>}
    </section>
  )
}
