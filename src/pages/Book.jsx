import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BUS_CLASSES, getSegment, getTrip } from '../../shared/routes.js'
import SeatMap from '../components/SeatMap.jsx'
import LoadError from '../components/LoadError.jsx'
import PhoneVerify from '../components/PhoneVerify.jsx'
import VerifiedNumber from '../components/VerifiedNumber.jsx'
import { MAX_SEATS, PAYMENT_HOLD_MINUTES, validateEmail, validateName } from '../../shared/booking-rules.js'
import { fmtDate, fmtDuration, fmtMoney, fmtTime, stopName, useT } from '../i18n/index.js'
import { createBooking, fetchConfig, fetchTakenSeats, startPayment } from '../lib/bookings.js'
import { useSession } from '../lib/session.js'
import { useLoad } from '../lib/useLoad.js'
import { useNow } from '../lib/useNow.js'
import { parseDateStr } from '../../shared/util.js'

export default function Book() {
  const t = useT()
  const { tripId, date } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const now = useNow()

  const trip = getTrip(tripId)
  const validDate = parseDateStr(date)
  const segment = trip && validDate ? getSegment(trip, params.get('from'), params.get('to'), date) : null

  const [selected, setSelected] = useState([])
  const session = useSession()
  const [name, setName] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('online')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const seats = useLoad(() => (segment ? fetchTakenSeats(tripId, date) : Promise.resolve(new Set())), [tripId, date])
  const config = useLoad(fetchConfig, [])

  if (!segment) {
    return (
      <div className="empty">
        <h1>{t('book.notFound')}</h1>
        <Link className="btn btn-primary" to="/">{t('book.searchAgain')}</Link>
      </div>
    )
  }

  if (segment.departAt <= now) {
    return (
      <div className="empty">
        <h1>{t('book.closedTitle')}</h1>
        <p className="muted">{t('book.closedText', { stop: stopName(segment.from), time: fmtTime(segment.departAt) })}</p>
        <Link className="btn btn-primary" to="/">{t('book.findAnother')}</Link>
      </div>
    )
  }

  const busClass = BUS_CLASSES[trip.cls]
  const total = segment.fare * selected.length
  const onlineAvailable = Boolean(config.data?.onlinePayment)
  const payingOnline = onlineAvailable && paymentMethod === 'online'

  function toggleSeat(seat) {
    setNotice('')
    setErrors((current) => ({ ...current, seats: undefined }))
    if (selected.includes(seat)) {
      setSelected(selected.filter((item) => item !== seat))
    } else if (selected.length >= MAX_SEATS) {
      setNotice(t('book.seatLimit', { max: MAX_SEATS }))
    } else {
      setSelected([...selected, seat])
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (submitting) return
    const found = {}
    const nameError = validateName(name)
    if (nameError) found.name = nameError
    if (payingOnline && validateEmail(email)) found.email = 'email_invalid'
    if (!session) found.phone = t('book.verifyFirst')
    if (selected.length === 0) found.seats = t('book.chooseSeat')
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setNotice('')
    setSubmitting(true)
    try {
      const booking = await createBooking({
        tripId,
        date,
        from: segment.from,
        to: segment.to,
        seats: selected,
        name,
        paymentMethod: payingOnline ? 'online' : 'board',
        ...(payingOnline ? { email } : {}),
      })
      if (!payingOnline) {
        navigate(`/tickets/${booking.ref}`, { replace: true })
        return
      }
      // The seat is already held, so if the payment page fails to open, the ticket offers another try.
      try {
        await startPayment(booking.ref, navigate)
      } catch {
        navigate(`/tickets/${booking.ref}`, { replace: true })
      }
    } catch (error) {
      setSubmitting(false)
      if (error.status === 401) {
        setErrors({ phone: t('book.verifyExpired') })
      } else if (error.data?.conflicts) {
        setSelected(selected.filter((seat) => !error.data.conflicts.includes(seat)))
        seats.reload()
        setNotice(t('book.seatGone', { seats: error.data.conflicts.join(', ') }))
      } else if (error.data?.fields) {
        setErrors(error.data.fields)
      } else {
        setNotice(error.message)
      }
    }
  }

  return (
    <>
      <Link to={`/results?${new URLSearchParams({ from: segment.from, to: segment.to, date })}`} className="back">{t('book.backToBuses')}</Link>
      <h1 className="page-title">{t('book.title')}</h1>
      <p className="muted">
        {stopName(segment.from)} → {stopName(segment.to)} · {fmtDate(validDate)}, {fmtTime(segment.departAt)} · {t(`classes.${trip.cls}`)}
      </p>

      <div className="book-layout">
        <section>
          {seats.data ? (
            <SeatMap total={busClass.seats} taken={seats.data} selected={selected} onToggle={toggleSeat} />
          ) : seats.error ? (
            <LoadError error={seats.error} onRetry={seats.reload} />
          ) : (
            <p className="muted" role="status">{t('book.loadingSeats')}</p>
          )}
          {notice && <p className="error" role="alert">{notice}</p>}
        </section>

        <form className="panel" onSubmit={submit} noValidate>
          <h2>{t('book.summary')}</h2>
          <dl className="summary">
            <div><dt>{t('book.leaves', { stop: stopName(segment.from) })}</dt><dd>{fmtTime(segment.departAt)}</dd></div>
            <div><dt>{t('book.reaches', { stop: stopName(segment.to) })}</dt><dd>{fmtTime(segment.arriveAt)}</dd></div>
            <div><dt>{t('book.journey')}</dt><dd>{fmtDuration(segment.durationMin)}</dd></div>
            <div><dt>{t('book.bus')}</dt><dd>{t('book.route', { number: trip.routeNumber })} · {trip.plate}</dd></div>
            <div><dt>{t('book.seats')}</dt><dd>{selected.length ? [...selected].sort((a, b) => a - b).join(', ') : t('book.noSeatsYet')}</dd></div>
          </dl>
          {errors.seats && <p className="error" role="alert">{errors.seats}</p>}

          <h2>{t('book.passenger')}</h2>
          <label className="field">
            <span>{t('book.fullName')}</span>
            <input
              value={name}
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              onChange={(event) => setName(event.target.value)}
            />
            {errors.name && <small className="error">{t(`errors.${errors.name}`)}</small>}
          </label>
          {session ? <VerifiedNumber phone={session.phone} /> : <PhoneVerify />}
          {errors.phone && !session && <p className="error" role="alert">{errors.phone}</p>}

          <h2>{t('book.payment')}</h2>
          {onlineAvailable && (
            <div className="pay-options" role="radiogroup" aria-label={t('book.payment')}>
              <label className={`pay-option${paymentMethod === 'online' ? ' pay-option-on' : ''}`}>
                <input type="radio" name="payment" checked={paymentMethod === 'online'} onChange={() => setPaymentMethod('online')} />
                <span>
                  <strong>{t('book.payOnline')}</strong>
                  <small className="muted">{t('book.payOnlineHint', { minutes: PAYMENT_HOLD_MINUTES })}</small>
                </span>
              </label>
              <label className={`pay-option${paymentMethod === 'board' ? ' pay-option-on' : ''}`}>
                <input type="radio" name="payment" checked={paymentMethod === 'board'} onChange={() => setPaymentMethod('board')} />
                <span>
                  <strong>{t('book.payOnBoard')}</strong>
                  <small className="muted">{t('book.payOnBoardHint')}</small>
                </span>
              </label>
            </div>
          )}
          {!onlineAvailable && <p className="muted small">{t('book.payOnBoardHint')}</p>}
          {payingOnline && (
            <label className="field">
              <span>{t('book.email')}</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                onChange={(event) => setEmail(event.target.value)}
              />
              {errors.email && <small className="error">{t(`errors.${errors.email}`)}</small>}
            </label>
          )}

          <div className="total">
            <span>{selected.length} × {fmtMoney(segment.fare)}</span>
            <strong>{fmtMoney(total)}</strong>
          </div>
          <button className="btn btn-primary btn-wide" type="submit" disabled={submitting}>
            {submitting ? t('book.booking') : payingOnline ? t('book.confirmPay') : t('book.confirm')}
          </button>
        </form>
      </div>
    </>
  )
}
