import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ALL_STOPS, destinationsFrom, getSegment, getTrip } from '../../shared/routes.js'
import HeroScene from '../components/HeroScene.jsx'
import { SwapIcon } from '../components/Icons.jsx'
import { fmtDate, fmtTime, sortedStops, stopName, useT } from '../i18n/index.js'
import { fetchMyBookings } from '../lib/bookings.js'
import { useSession } from '../lib/session.js'
import { useLoad } from '../lib/useLoad.js'
import { addDays, parseDateStr, toDateStr } from '../../shared/util.js'

const POPULAR = [
  ['Colombo Fort', 'Kandy'],
  ['Colombo Fort', 'Galle'],
  ['Makumbura', 'Matara'],
  ['Colombo Fort', 'Jaffna'],
  ['Colombo Fort', 'Badulla'],
]

function nextTicket(bookings, now) {
  return (bookings ?? [])
    .filter((booking) => booking.status === 'confirmed' && getTrip(booking.tripId))
    .map((booking) => ({
      booking,
      departAt: getSegment(getTrip(booking.tripId), booking.from, booking.to, booking.date).departAt,
    }))
    .filter((item) => item.departAt > now)
    .sort((a, b) => a.departAt - b.departAt)[0]
}

export default function Search() {
  const t = useT()
  const navigate = useNavigate()
  const now = new Date()
  const today = toDateStr(now)
  const tomorrow = toDateStr(addDays(now, 1))
  const lastDate = toDateStr(addDays(now, 30))

  const [from, setFrom] = useState('Colombo Fort')
  const [to, setTo] = useState('Kandy')
  const [date, setDate] = useState(today)
  const [dateError, setDateError] = useState(false)

  const destinations = destinationsFrom(from)
  const session = useSession()
  const { data: bookings } = useLoad(() => (session ? fetchMyBookings() : Promise.resolve([])), [session?.token])
  const upcoming = nextTicket(bookings, now)

  function changeFrom(value) {
    setFrom(value)
    const options = destinationsFrom(value)
    if (!options.includes(to)) setTo(options[0])
  }

  function swap() {
    setFrom(to)
    setTo(from)
  }

  function submit(event) {
    event.preventDefault()
    if (!parseDateStr(date) || date < today || date > lastDate) {
      setDateError(true)
      return
    }
    setDateError(false)
    navigate(`/results?${new URLSearchParams({ from, to, date })}`)
  }

  return (
    <>
      <section className="hero">
        <HeroScene />
        <div className="hero-text">
          <h1>{t('search.heroTitle')}</h1>
          <p>{t('search.heroText')}</p>
        </div>
      </section>

      <form className="search-card" onSubmit={submit}>
        <div className="search-stops">
          <label className="field">
            <span>{t('search.from')}</span>
            <select value={from} onChange={(event) => changeFrom(event.target.value)}>
              {sortedStops(ALL_STOPS).map((stop) => <option key={stop} value={stop}>{stopName(stop)}</option>)}
            </select>
          </label>
          <button type="button" className="swap" onClick={swap} aria-label={t('search.swap')}>
            <SwapIcon />
          </button>
          <label className="field">
            <span>{t('search.to')}</span>
            <select value={to} onChange={(event) => setTo(event.target.value)}>
              {sortedStops(destinations).map((stop) => <option key={stop} value={stop}>{stopName(stop)}</option>)}
            </select>
          </label>
        </div>

        <div className="search-date">
          <label className="field">
            <span>{t('search.date')}</span>
            <input
              type="date"
              value={date}
              min={today}
              max={lastDate}
              required
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <div className="chips">
            <button type="button" className={`chip${date === today ? ' chip-on' : ''}`} onClick={() => setDate(today)}>{t('search.today')}</button>
            <button type="button" className={`chip${date === tomorrow ? ' chip-on' : ''}`} onClick={() => setDate(tomorrow)}>{t('search.tomorrow')}</button>
          </div>
        </div>
        {dateError && <p className="error" role="alert">{t('search.dateError')}</p>}

        <button className="btn btn-primary btn-wide" type="submit">{t('search.find')}</button>
      </form>

      {upcoming && (
        <Link className="upcoming" to={`/tickets/${upcoming.booking.ref}`}>
          <span className="muted small">{t('search.nextTrip')}</span>
          <strong>{stopName(upcoming.booking.from)} → {stopName(upcoming.booking.to)}</strong>
          <span>{fmtDate(upcoming.departAt)}, {fmtTime(upcoming.departAt)}</span>
        </Link>
      )}

      <section className="section">
        <h2>{t('search.popular')}</h2>
        <div className="popular">
          {POPULAR.map(([start, end]) => (
            <Link key={end} className="popular-item" to={`/results?${new URLSearchParams({ from: start, to: end, date: today })}`}>
              {stopName(start)} → {stopName(end)}
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}
