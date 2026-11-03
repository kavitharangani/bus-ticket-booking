import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BUS_CLASSES, findTrips } from '../../shared/routes.js'
import { LiveBadge } from '../components/LiveStatus.jsx'
import { fmtDate, fmtDuration, fmtMoney, fmtTime, stopName, useT } from '../i18n/index.js'
import { fetchAvailability } from '../lib/bookings.js'
import { simulateTrip } from '../lib/tracking.js'
import { useLoad } from '../lib/useLoad.js'
import { useNow } from '../lib/useNow.js'
import { parseDateStr } from '../../shared/util.js'

function TripCard({ trip, segment, date, now, takenCount }) {
  const t = useT()
  const sim = simulateTrip(trip, date, now)
  // takenCount is undefined until the seat counts have loaded.
  const left = takenCount === undefined ? null : BUS_CLASSES[trip.cls].seats - takenCount
  const canBook = segment.departAt > now && left !== 0
  const nextDay = segment.arriveAt.getDate() !== segment.departAt.getDate()
  const query = new URLSearchParams({ from: segment.from, to: segment.to })
  const isLiveDay = sim.hasForecast && sim.status !== 'completed'
  const features = BUS_CLASSES[trip.cls].features

  return (
    <article className={`trip-card${segment.departAt <= now ? ' trip-gone' : ''}`}>
      <div className="trip-times">
        <div>
          <strong className="time">{fmtTime(segment.departAt)}</strong>
          <span className="muted small">{stopName(segment.from)}</span>
        </div>
        <div className="trip-line">
          <span className="muted small">{fmtDuration(segment.durationMin)}</span>
        </div>
        <div className="trip-end">
          <strong className="time">
            {fmtTime(segment.arriveAt)}
            {nextDay && <sup className="next-day">{t('results.nextDay')}</sup>}
          </strong>
          <span className="muted small">{stopName(segment.to)}</span>
        </div>
      </div>

      <div className="trip-meta">
        <span className="route-no">{trip.routeNumber}</span>
        <span className="badge badge-class">{t(`classes.${trip.cls}`)}</span>
        <span className="muted small">{t(`operators.${trip.operator}`)} · {trip.plate}</span>
        {features.length > 0 && (
          <span className="muted small">{features.map((feature) => t(`features.${feature}`)).join(' · ')}</span>
        )}
      </div>

      {isLiveDay && <div className="trip-live"><LiveBadge sim={sim} /></div>}

      <div className="trip-action">
        <div>
          <strong className="price">{fmtMoney(segment.fare)}</strong>
          {left !== null && (
            <span className={`small ${left <= 5 ? 'seats-low' : 'muted'}`}>
              {left === 0 ? t('results.full') : t('results.seatsLeft', { n: left })}
            </span>
          )}
        </div>
        <div className="trip-buttons">
          {isLiveDay && (
            <Link className="btn btn-ghost" to={`/track/${trip.id}/${date}?stop=${encodeURIComponent(segment.from)}`}>{t('results.track')}</Link>
          )}
          {canBook ? (
            <Link className="btn btn-primary" to={`/book/${trip.id}/${date}?${query}`}>{t('results.select')}</Link>
          ) : (
            <span className="muted small">{left === 0 ? t('results.noSeats') : t('results.closed')}</span>
          )}
        </div>
      </div>
    </article>
  )
}

export default function Results() {
  const t = useT()
  const [params] = useSearchParams()
  const from = params.get('from')
  const to = params.get('to')
  const date = params.get('date')
  const parsedDate = parseDateStr(date)
  const [classFilter, setClassFilter] = useState('all')
  const now = useNow()
  const availability = useLoad(() => (parsedDate ? fetchAvailability(date) : Promise.resolve({})), [date])

  const results = useMemo(() => (from && to && parsedDate ? findTrips(from, to, date) : []), [from, to, date, parsedDate?.getTime()])

  if (!from || !to || !parsedDate) {
    return (
      <div className="empty">
        <h1>{t('results.missingTitle')}</h1>
        <Link className="btn btn-primary" to="/">{t('results.newSearch')}</Link>
      </div>
    )
  }

  const classes = [...new Set(results.map((item) => item.trip.cls))]
  const filtered = results.filter((item) => classFilter === 'all' || item.trip.cls === classFilter)
  // Buses that can still be booked come first, so today's search doesn't open on departed ones.
  const shown = [
    ...filtered.filter((item) => item.segment.departAt > now),
    ...filtered.filter((item) => item.segment.departAt <= now),
  ]

  return (
    <>
      <Link to="/" className="back">{t('results.change')}</Link>
      <h1 className="page-title">{stopName(from)} → {stopName(to)}</h1>
      <p className="muted">{fmtDate(parsedDate)} · {t('results.count', { n: results.length })}</p>

      {classes.length > 1 && (
        <div className="chips filter-row">
          <button type="button" className={`chip${classFilter === 'all' ? ' chip-on' : ''}`} onClick={() => setClassFilter('all')}>{t('results.all')}</button>
          {classes.map((cls) => (
            <button key={cls} type="button" className={`chip${classFilter === cls ? ' chip-on' : ''}`} onClick={() => setClassFilter(cls)}>
              {t(`classes.${cls}`)}
            </button>
          ))}
        </div>
      )}

      {availability.error && <p className="error" role="alert">{t('results.seatsError', { message: availability.error.message })}</p>}

      {shown.length === 0 ? (
        <div className="empty">
          <p>{t('results.noBuses')}</p>
          <Link className="btn btn-primary" to="/">{t('results.tryAnother')}</Link>
        </div>
      ) : (
        <div className="trip-list">
          {shown.map(({ trip, segment }) => (
            <TripCard
              key={trip.id}
              trip={trip}
              segment={segment}
              date={date}
              now={now}
              takenCount={availability.data ? availability.data[trip.id] ?? 0 : undefined}
            />
          ))}
        </div>
      )}
    </>
  )
}
