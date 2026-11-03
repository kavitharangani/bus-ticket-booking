import { Link, useSearchParams } from 'react-router-dom'
import { ALL_STOPS, destinationsFrom } from '../../shared/routes.js'
import { fmtDuration, fmtTime, sortedStops, stopName, tripName, useT } from '../i18n/index.js'
import { arrivalsAt } from '../lib/tracking.js'
import { useNow } from '../lib/useNow.js'

export default function BusTimes() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const now = useNow()
  const requested = params.get('stop')
  const stop = ALL_STOPS.includes(requested) ? requested : 'Colombo Fort'
  const destinations = destinationsFrom(stop)
  const goingTo = destinations.includes(params.get('to')) ? params.get('to') : ''

  const arrivals = arrivalsAt(stop, { goingTo, now })

  function update(nextStop, nextTo) {
    const next = { stop: nextStop }
    if (nextTo) next.to = nextTo
    setParams(next, { replace: true })
  }

  return (
    <>
      <h1 className="page-title">{t('times.title')}</h1>
      <p className="muted">{t('times.text')}</p>

      <div className="times-filter">
        <label className="field">
          <span>{t('times.stop')}</span>
          <select value={stop} onChange={(event) => update(event.target.value, '')}>
            {sortedStops(ALL_STOPS).map((name) => <option key={name} value={name}>{stopName(name)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('times.goingTo')}</span>
          <select value={goingTo} onChange={(event) => update(stop, event.target.value)}>
            <option value="">{t('times.any')}</option>
            {sortedStops(destinations).map((name) => <option key={name} value={name}>{stopName(name)}</option>)}
          </select>
        </label>
      </div>

      {arrivals.length === 0 ? (
        <div className="empty">
          <p>{t('times.none', { stop: stopName(stop) })}</p>
        </div>
      ) : (
        <ul className="arrivals" aria-live="polite">
          {arrivals.map(({ trip, date, stop: arrival, minutes, sim, endsHere }) => (
            <li key={`${trip.id}-${date}`}>
              <Link to={`/track/${trip.id}/${date}?stop=${encodeURIComponent(stop)}`} className="arrival">
                <div className="arrival-eta">
                  <strong>{minutes < 60 ? minutes : fmtDuration(minutes)}</strong>
                  {minutes < 60 && <span>{t('times.min')}</span>}
                </div>
                <div className="arrival-info">
                  <div className="arrival-title">
                    <span className="route-no">{trip.routeNumber}</span>
                    <strong>{tripName(trip)}</strong>
                  </div>
                  <div className="muted small">
                    {t(`classes.${trip.cls}`)} · {trip.plate}{endsHere ? ` · ${t('times.endsHere')}` : ''}
                  </div>
                </div>
                <div className="arrival-time">
                  <strong>{fmtTime(arrival.estimated)}</strong>
                  <div className={`small ${arrival.delayMin > 5 ? 'seats-low' : 'muted'}`}>
                    {arrival.delayMin > 1 ? t('live.late', { n: arrival.delayMin }) : t('live.onTime')}
                  </div>
                  {sim.status === 'scheduled' && <div className="muted small">{t('live.scheduled')}</div>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
