import { useT } from '../i18n/index.js'

export function LiveBadge({ sim }) {
  const t = useT()
  const delay = sim.delayMin <= 1 ? t('live.onTime') : t('live.late', { n: sim.delayMin })
  if (sim.status === 'completed') return <span className="badge badge-muted">{t('live.finished')}</span>
  if (sim.status === 'scheduled') {
    if (!sim.hasForecast) return <span className="badge badge-muted">{t('live.scheduled')}</span>
    return <span className={`badge ${sim.delayMin > 5 ? 'badge-late' : 'badge-muted'}`}>{t('live.notLeft', { delay })}</span>
  }
  return (
    <span className={`badge ${sim.delayMin > 5 ? 'badge-late' : 'badge-live'}`}>
      <span className="pulse" aria-hidden="true" /> {t('live.onRoad', { delay })}
    </span>
  )
}
