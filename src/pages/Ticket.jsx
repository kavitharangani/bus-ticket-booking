import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getSegment, getTrip } from '../../shared/routes.js'
import { LiveBadge } from '../components/LiveStatus.jsx'
import LoadError from '../components/LoadError.jsx'
import PhoneVerify from '../components/PhoneVerify.jsx'
import VerifiedNumber from '../components/VerifiedNumber.jsx'
import { fmtDate, fmtDuration, fmtMoney, fmtTime, stopName, useT } from '../i18n/index.js'
import { cancelBooking, fetchBooking, startPayment } from '../lib/bookings.js'
import { useSession } from '../lib/session.js'
import { useLoad } from '../lib/useLoad.js'
import { simulateTrip, stopOf } from '../lib/tracking.js'
import { useNow } from '../lib/useNow.js'
import { minutesBetween, parseDateStr } from '../../shared/util.js'

const AMOUNT_LABELS = {
  pay_on_board: 'ticket.toPayBoard',
  awaiting: 'ticket.toPay',
  paid: 'ticket.paidOnline',
}

function countdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function Ticket() {
  const t = useT()
  const { ref } = useParams()
  const navigate = useNavigate()
  const now = useNow(1000)
  const session = useSession()
  const { data: loaded, error, loading, reload } = useLoad(
    () => (session ? fetchBooking(ref) : Promise.resolve(null)),
    [ref, session?.token],
  )
  const [updated, setUpdated] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [paying, setPaying] = useState(false)
  const [actionError, setActionError] = useState('')

  // After switching numbers, the previous number's ticket must not stay on screen.
  const latest = updated?.ref === ref ? updated : loaded
  const booking = session && latest?.passenger.phone === session.phone ? latest : null
  const awaiting = booking?.status === 'confirmed' && booking.payment.status === 'awaiting'

  // The payment gateway tells the server, not this page, so keep asking until the ticket changes.
  useEffect(() => {
    if (!awaiting) return undefined
    const timer = setInterval(reload, 5000)
    return () => clearInterval(timer)
  }, [awaiting, reload])

  if (!session) {
    return (
      <>
        <Link to="/tickets" className="back">{t('common.backToTickets')}</Link>
        <h1 className="page-title">{t('ticket.verifyTitle')}</h1>
        <p className="muted">{t('ticket.verifyText')}</p>
        <section className="panel narrow-panel">
          <PhoneVerify />
        </section>
      </>
    )
  }

  const trip = booking && getTrip(booking.tripId)

  if (error && !booking) return <LoadError error={error} onRetry={reload} />
  if (loading && !booking) return <p className="muted" role="status">{t('ticket.loading')}</p>
  if (!booking || !trip) {
    return (
      <>
        <Link to="/tickets" className="back">{t('common.backToTickets')}</Link>
        <h1 className="page-title">{t('ticket.notFound')}</h1>
        <p className="muted">{t('ticket.notFoundText', { ref })}</p>
        <VerifiedNumber phone={session.phone} />
      </>
    )
  }

  const segment = getSegment(trip, booking.from, booking.to, booking.date)
  const sim = simulateTrip(trip, booking.date, now)
  const boarding = stopOf(sim, booking.from)
  const cancelled = booking.status === 'cancelled'
  const notDeparted = segment.departAt > now
  const minutesToBus = minutesBetween(now, boarding.estimated)
  const paymentStatus = booking.payment.status
  const amount = fmtMoney(booking.total)
  const arrival = { stop: stopName(booking.from), time: fmtTime(boarding.estimated), duration: fmtDuration(minutesToBus) }

  async function cancel() {
    setActionError('')
    setCancelling(true)
    try {
      setUpdated(await cancelBooking(booking.ref))
      setConfirming(false)
    } catch (failure) {
      setActionError(failure.message)
    } finally {
      setCancelling(false)
    }
  }

  async function pay() {
    setActionError('')
    setPaying(true)
    try {
      await startPayment(booking.ref, navigate)
    } catch (failure) {
      setActionError(failure.message)
      setPaying(false)
    }
  }

  return (
    <>
      <Link to="/tickets" className="back">{t('common.backToTickets')}</Link>
      {!cancelled && !awaiting && (
        <p className="confirm-note" role="status">{t(paymentStatus === 'paid' ? 'ticket.notePaid' : 'ticket.noteBooked')}</p>
      )}

      {awaiting && (
        <section className="pay-box">
          <h2>{t('ticket.awaitingTitle')}</h2>
          <p>{t('ticket.awaitingText', { time: countdown(booking.payment.expiresAt - now) })}</p>
          {actionError && !confirming && <p className="error" role="alert">{actionError}</p>}
          <button type="button" className="btn btn-primary" disabled={paying} onClick={pay}>
            {paying ? t('ticket.opening') : t('ticket.payNow', { amount })}
          </button>
        </section>
      )}

      {cancelled && paymentStatus === 'refund_due' && <p className="ticket-message" role="status">{t('ticket.refundDue', { amount, ref: booking.ref })}</p>}
      {cancelled && paymentStatus === 'expired' && <p className="ticket-message" role="status">{t('ticket.expired')}</p>}
      {cancelled && paymentStatus === 'chargedback' && <p className="ticket-message" role="status">{t('ticket.chargedback')}</p>}

      <article className={`ticket${cancelled ? ' ticket-cancelled' : ''}`}>
        <header className="ticket-top">
          <div>
            <span className="ticket-label">{t('ticket.reference')}</span>
            <strong className="ticket-ref">{booking.ref}</strong>
          </div>
          <span className="route-no route-no-lg">{trip.routeNumber}</span>
        </header>

        <div className="ticket-route">
          <div>
            <strong className="time">{fmtTime(segment.departAt)}</strong>
            <span>{stopName(booking.from)}</span>
          </div>
          <span className="muted small">{fmtDuration(segment.durationMin)}</span>
          <div className="trip-end">
            <strong className="time">{fmtTime(segment.arriveAt)}</strong>
            <span>{stopName(booking.to)}</span>
          </div>
        </div>

        <div className="ticket-tear" aria-hidden="true" />

        <dl className="ticket-grid">
          <div><dt>{t('ticket.date')}</dt><dd>{fmtDate(parseDateStr(booking.date))}</dd></div>
          <div><dt>{t('ticket.seats')}</dt><dd>{booking.seats.join(', ')}</dd></div>
          <div><dt>{t('ticket.passenger')}</dt><dd>{booking.passenger.name}</dd></div>
          <div><dt>{t('ticket.phone')}</dt><dd>{booking.passenger.phone}</dd></div>
          <div><dt>{t('ticket.bus')}</dt><dd>{t(`classes.${trip.cls}`)} · {trip.plate}</dd></div>
          <div><dt>{t(cancelled ? 'ticket.total' : AMOUNT_LABELS[paymentStatus] ?? 'ticket.total')}</dt><dd>{amount}</dd></div>
        </dl>
        {cancelled && <p className="ticket-stamp">{t('ticket.cancelled')}</p>}
      </article>

      {!cancelled && (
        <section className="panel ticket-live">
          <LiveBadge sim={sim} />
          {sim.status !== 'completed' && minutesToBus > 0 && (
            <p>{t(minutesToBus <= 180 ? 'ticket.arrivalIn' : 'ticket.arrival', arrival)}</p>
          )}
          <div className="trip-buttons">
            <Link className="btn btn-primary" to={`/track/${trip.id}/${booking.date}?stop=${encodeURIComponent(booking.from)}`}>{t('ticket.track')}</Link>
            {notDeparted && !confirming && (
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>{t('ticket.cancel')}</button>
            )}
          </div>
          {confirming && (
            <div className="cancel-box" role="alertdialog" aria-label={t('ticket.cancel')}>
              <p>{t('ticket.cancelAsk', { seats: booking.seats.join(', ') })}</p>
              {paymentStatus === 'paid' && <p>{t('ticket.cancelRefund', { amount })}</p>}
              {actionError && <p className="error" role="alert">{actionError}</p>}
              <div className="trip-buttons">
                <button type="button" className="btn btn-danger" disabled={cancelling} onClick={cancel}>
                  {cancelling ? t('ticket.cancelling') : t('ticket.cancelYes')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>{t('ticket.keep')}</button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  )
}
