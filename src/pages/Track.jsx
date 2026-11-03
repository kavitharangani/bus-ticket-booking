import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getTrip } from '../../shared/routes.js'
import { LiveBadge } from '../components/LiveStatus.jsx'
import StopTimeline from '../components/StopTimeline.jsx'
import { BusIcon } from '../components/Icons.jsx'
import { fmtDate, fmtDuration, fmtTime, stopName, tripName, useT } from '../i18n/index.js'
import { simulateTrip, stopOf } from '../lib/tracking.js'
import { useNow } from '../lib/useNow.js'
import { minutesBetween, parseDateStr } from '../../shared/util.js'

function Headline({ sim, stop, now }) {
  const t = useT()
  if (!stop) return null
  const name = stopName(stop.name)
  const minutes = minutesBetween(now, stop.estimated)
  if (minutes <= 0) {
    return (
      <div className="eta-card eta-card-done">
        <span>{t('track.passed', { stop: name })}</span>
        <strong>{fmtTime(stop.estimated)}</strong>
      </div>
    )
  }
  if (minutes > 24 * 60) {
    return (
      <div className="eta-card eta-card-done">
        <span>{t('track.dueAt', { stop: name })}</span>
        <strong>{fmtDate(stop.estimated)}, {fmtTime(stop.estimated)}</strong>
      </div>
    )
  }
  return (
    <div className="eta-card">
      <span>{t(sim.hasForecast ? 'track.reachesIn' : 'track.scheduledIn', { stop: name })}</span>
      <strong>{fmtDuration(minutes)}</strong>
      <span>{t('track.around', { time: fmtTime(stop.estimated) })}</span>
    </div>
  )
}

export default function Track() {
  const t = useT()
  const { tripId, date } = useParams()
  const [params, setParams] = useSearchParams()
  const now = useNow(10000)

  const trip = getTrip(tripId)
  const validDate = parseDateStr(date)

  if (!trip || !validDate) {
    return (
      <div className="empty">
        <h1>{t('track.notFound')}</h1>
        <Link className="btn btn-primary" to="/times">{t('track.seeTimes')}</Link>
      </div>
    )
  }

  const sim = simulateTrip(trip, date, now)
  const myStopName = params.get('stop') ?? ''
  const myStop = stopOf(sim, myStopName)
  const nextStop = sim.status === 'running' ? sim.stops[sim.nextIndex] : null
  const lastStop = sim.stops[sim.stops.length - 1]

  return (
    <>
      <Link to="/times" className="back">{t('track.back')}</Link>
      <div className="track-head">
        <span className="route-no route-no-lg">{trip.routeNumber}</span>
        <div>
          <h1 className="page-title">{tripName(trip)}</h1>
          <p className="muted">{fmtDate(validDate)} · {t(`classes.${trip.cls}`)} · {t(`operators.${trip.operator}`)} · {trip.plate}</p>
        </div>
      </div>

      <div className="track-status">
        <LiveBadge sim={sim} />
        {nextStop && <span>{t('track.nextStop')} <strong>{stopName(nextStop.name)}</strong> {t('track.at', { time: fmtTime(nextStop.estimated) })}</span>}
        {sim.status === 'completed' && <span>{t('track.reached', { stop: stopName(lastStop.name), time: fmtTime(lastStop.estimated) })}</span>}
      </div>

      <div className="route-strip" role="img" aria-label={t('track.progress', { percent: Math.round(sim.routeProgress * 100) })}>
        <div className="route-strip-fill" style={{ width: `${sim.routeProgress * 100}%` }} />
        <span className="route-strip-bus" style={{ left: `${sim.routeProgress * 100}%` }}><BusIcon size={16} /></span>
      </div>

      <div className="track-layout">
        <aside>
          <label className="field">
            <span>{t('track.yourStop')}</span>
            <select value={myStop ? myStopName : ''} onChange={(event) => setParams(event.target.value ? { stop: event.target.value } : {}, { replace: true })}>
              <option value="">{t('track.chooseStop')}</option>
              {trip.stops.map((stop) => <option key={stop.name} value={stop.name}>{stopName(stop.name)}</option>)}
            </select>
          </label>
          <Headline sim={sim} stop={myStop} now={now} />
        </aside>
        <StopTimeline sim={sim} highlightStop={myStopName} />
      </div>
      <p className="muted small">{t('track.note')}</p>
    </>
  )
}
