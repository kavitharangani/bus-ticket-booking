import { useT } from '../i18n/index.js'
import { signOut } from '../lib/bookings.js'

export default function VerifiedNumber({ phone }) {
  const t = useT()
  return (
    <p className="verified">
      <span>{t('verify.verified')} <strong>{phone}</strong></span>
      <button type="button" className="link-btn" onClick={signOut}>{t('verify.useAnother')}</button>
    </p>
  )
}
