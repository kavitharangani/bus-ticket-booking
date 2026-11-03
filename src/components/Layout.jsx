import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BusIcon } from './Icons.jsx'
import { LANGUAGES, setLanguage, useLanguage, useT } from '../i18n/index.js'
import { BROWSER_DEMO } from '../lib/bookings.js'

function LanguageSwitch() {
  const t = useT()
  const current = useLanguage()
  return (
    <div className="lang-switch" role="group" aria-label={t('language')}>
      {LANGUAGES.map(({ code, label }) => (
        <button key={code} type="button" lang={code} aria-pressed={current === code} onClick={() => setLanguage(code)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Layout() {
  const t = useT()
  const { pathname } = useLocation()
  const links = [
    { to: '/', label: t('nav.book'), end: true },
    { to: '/times', label: t('nav.times') },
    { to: '/tickets', label: t('nav.tickets') },
  ]
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <BusIcon /> BusLanka
          </Link>
          <LanguageSwitch />
          <nav className="nav" aria-label={t('nav.label')}>
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="page">
        {/* A new key on each page replays the entrance animation. */}
        <div key={pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
      <footer className="footer">
        {t('footer')}
        {BROWSER_DEMO && ` ${t('footerBrowser')}`}
      </footer>
    </div>
  )
}
