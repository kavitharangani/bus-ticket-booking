import { BusIcon } from './Icons.jsx'
import { fmtTime, stopName, useT } from '../i18n/index.js'

export default function StopTimeline({ sim, highlightStop }) {
  const t = useT()
  return (
    <ol className="timeline">
      {sim.stops.map((stop, index) => {
        const passed = sim.status === 'completed' || (sim.status === 'running' && index < sim.nextIndex)
        const busIsAfterThis = sim.status === 'running' && index === sim.nextIndex - 1
        const changed = stop.estimated.getTime() !== stop.scheduled.getTime()
        return (
          <li
            key={stop.name}
            className={`timeline-stop${passed ? ' is-passed' : ''}${stop.name === highlightStop ? ' is-mine' : ''}`}
            style={busIsAfterThis ? { '--fill': `${sim.segmentProgress * 100}%` } : passed ? { '--fill': '100%' } : undefined}
          >
            <span className="timeline-dot" aria-hidden="true" />
            <div className="timeline-body">
              <div>
                <strong>{stopName(stop.name)}</strong>
                {stop.name === highlightStop && <span className="mine-tag">{t('track.yourStop')}</span>}
                <div className="muted small">{t('track.km', { n: stop.km })}</div>
              </div>
              <div className="timeline-time">
                <strong>{fmtTime(stop.estimated)}</strong>
                {changed && <div className="muted small strike">{fmtTime(stop.scheduled)}</div>}
              </div>
            </div>
            {busIsAfterThis && (
              <span className="timeline-bus" style={{ top: `calc(0.55rem + ${sim.segmentProgress * 100}%)` }} title={t('track.busHere')}>
                <BusIcon size={14} />
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
