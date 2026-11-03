import { useSyncExternalStore } from 'react'
import en from './en.js'
import si from './si.js'
import ta from './ta.js'

const LANGUAGE_KEY = 'buslanka.language'
const DICTIONARIES = { en, si, ta }
const LOCALES = { en: 'en-US', si: 'si-LK', ta: 'ta-LK' }
const listeners = new Set()

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'si', label: 'සිංහල' },
  { code: 'ta', label: 'தமிழ்' },
]

function initialLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY)
    if (DICTIONARIES[stored]) return stored
  } catch {
    // Falls through to the browser's language.
  }
  const browser = typeof navigator === 'undefined' ? '' : String(navigator.language).slice(0, 2)
  return DICTIONARIES[browser] ? browser : 'en'
}

let language = initialLanguage()

function applyToPage() {
  if (typeof document !== 'undefined') document.documentElement.lang = language
}
applyToPage()

export function setLanguage(code) {
  language = code
  applyToPage()
  try {
    localStorage.setItem(LANGUAGE_KEY, code)
  } catch {
    // The choice still applies until the page is closed.
  }
  listeners.forEach((listener) => listener())
}

function lookup(dictionary, key) {
  // Stop and feature names can contain spaces, so only the first dot separates the group from the name.
  const dot = key.indexOf('.')
  return dot === -1 ? dictionary[key] : dictionary[key.slice(0, dot)]?.[key.slice(dot + 1)]
}

export function hasTranslation(key) {
  return lookup(en, key) !== undefined
}

export function translate(key, params = {}) {
  const text = lookup(DICTIONARIES[language], key) ?? lookup(en, key) ?? key
  return text.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match)
}

export function stopName(name) {
  return translate(`stops.${name}`)
}

export function sortedStops(names) {
  return [...names].sort((a, b) => stopName(a).localeCompare(stopName(b), LOCALES[language]))
}

export function tripName(trip) {
  return `${stopName(trip.stops[0].name)} → ${stopName(trip.stops[trip.stops.length - 1].name)}`
}

// Not every browser ships Sinhala or Tamil date data, so these use our own words instead of toLocaleString.
export function fmtTime(date) {
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return translate('time.clock', {
    time: `${hours % 12 || 12}:${minutes}`,
    period: translate(hours < 12 ? 'time.am' : 'time.pm'),
  })
}

export function fmtDate(date) {
  return translate('time.date', {
    weekday: translate('time.weekdays').split(',')[date.getDay()],
    day: date.getDate(),
    month: translate('time.months').split(',')[date.getMonth()],
    year: date.getFullYear(),
  })
}

export function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return translate('time.minutes', { m })
  return m === 0 ? translate('time.hours', { h }) : translate('time.hoursMinutes', { h, m })
}

export function fmtMoney(amount) {
  return translate('money', { amount: amount.toLocaleString('en-US') })
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Components that show text call this so that they redraw when the language changes.
export function useT() {
  useSyncExternalStore(subscribe, () => language)
  return translate
}

export function useLanguage() {
  return useSyncExternalStore(subscribe, () => language)
}
