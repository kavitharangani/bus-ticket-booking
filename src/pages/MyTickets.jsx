import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getSegment, getTrip } from '../../shared/routes.js'
import LoadError from '../components/LoadError.jsx'
import PhoneVerify from '../components/PhoneVerify.jsx'
import VerifiedNumber from '../components/VerifiedNumber.jsx'
import { fmtDate, fmtMoney, fmtTime, stopName, useT } from '../i18n/index.js'
import { fetchMyBookings } from '../lib/bookings.js'
import { useSession } from '../lib/session.js'
import { useLoad } from '../lib/useLoad.js'

function TicketRow({ item }) {
  const t = useT()
  const { booking, segment } = item
  const cancelled = booking.status === 'cancelled'
  return (
    <Link to={`/tickets/${booking.ref}`} className={`ticket-row${cancelled ? ' ticket-row-off' : ''}`}>
      <div>
        <strong>{stopName(booking.from)} → {stopName(booking.to)}</strong>
        <div className="muted small">
          {fmtDate(segment.departAt)}, {fmtTime(segment.departAt)} · {t('common.seatList', { seats: booking.seats.join(', ') })}
        </div>
      </div>
      <div className="ticket-row-end">
        <strong>{fmtMoney(booking.total)}</strong>
        {cancelled && <div className="muted small">{t('ticket.cancelled')}</div>}
        {!cancelled && booking.payment.status === 'awaiting' && <div className="seats-low small">{t('tickets.awaiting')}</div>}
        {!cancelled && booking.payment.status !== 'awaiting' && <div className="muted small">{booking.ref}</div>}
      </div>
    </Link>
  )
}

export default function MyTickets() {
  const t = useT()
  const session = useSession()
  const now = new Date()
  const { data: bookings, error, loading, reload } = useLoad(
    () => (session ? fetchMyBookings() : Promise.resolve([])),
    [session?.token],
  )
  const items = useMemo(
    () =>
      (bookings ?? [])
        // After switching numbers, the previous number's tickets must not stay on screen.
        .filter((booking) => booking.passenger.phone === session?.phone)
        .map((booking) => {
          const trip = getTrip(booking.tripId)
          return trip ? { booking, segment: getSegment(trip, booking.from, booking.to, booking.date) } : null
        })
        .filter(Boolean)
        .sort((a, b) => a.segment.departAt - b.segment.departAt),
    [bookings, session?.phone],
  )

  if (!session) {
    return (
      <>
        <h1 className="page-title">{t('tickets.title')}</h1>
        <p className="muted">{t('tickets.verifyText')}</p>
        <section className="panel narrow-panel">
          <PhoneVerify />
        </section>
      </>
    )
  }

  if (error && !bookings) return <LoadError error={error} onRetry={reload} />
  if (loading && !bookings) return <p className="muted" role="status">{t('tickets.loading')}</p>

  const upcoming = items.filter((item) => item.booking.status === 'confirmed' && item.segment.arriveAt > now)
  const past = items.filter((item) => !upcoming.includes(item)).reverse()

  return (
    <>
      <h1 className="page-title">{t('tickets.title')}</h1>
      <VerifiedNumber phone={session.phone} />
      {items.length === 0 ? (
        <div className="empty">
          <p className="muted">{t('tickets.none')}</p>
          <Link className="btn btn-primary" to="/">{t('tickets.bookSeat')}</Link>
        </div>
      ) : (
        <>
          <section className="section">
            <h2>{t('tickets.upcoming')}</h2>
            {upcoming.length === 0 && <p className="muted">{t('tickets.noUpcoming')}</p>}
            <div className="ticket-list">
              {upcoming.map((item) => <TicketRow key={item.booking.ref} item={item} />)}
            </div>
          </section>
          {past.length > 0 && (
            <section className="section">
              <h2>{t('tickets.past')}</h2>
              <div className="ticket-list">
                {past.map((item) => <TicketRow key={item.booking.ref} item={item} />)}
              </div>
            </section>
          )}
        </>
      )}
    </>
  )
}
