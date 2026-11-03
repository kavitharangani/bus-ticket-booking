import { useT } from '../i18n/index.js'

export default function LoadError({ error, onRetry }) {
  const t = useT()
  return (
    <div className="empty" role="alert">
      <p>{error.message}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>{t('common.retry')}</button>
    </div>
  )
}
