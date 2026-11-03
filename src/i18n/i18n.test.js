import { describe, expect, it } from 'vitest'
import { ALL_STOPS, BUS_CLASSES } from '../../shared/routes.js'
import en from './en.js'
import si from './si.js'
import ta from './ta.js'
import { fmtDate, fmtTime, hasTranslation, translate } from './index.js'

function flatten(dictionary, prefix = '') {
  return Object.entries(dictionary).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : flatten(value, `${prefix}${key}.`),
  )
}

function placeholders(text) {
  return (text.match(/\{\w+\}/g) ?? []).sort()
}

const english = new Map(flatten(en))

describe.each([['Sinhala', si, /[඀-෿]/], ['Tamil', ta, /[஀-௿]/]])('%s translation', (_, dictionary, script) => {
  const translated = new Map(flatten(dictionary))

  it('has exactly the same keys as English', () => {
    expect([...translated.keys()].sort()).toEqual([...english.keys()].sort())
  })

  it('keeps the same placeholders as English', () => {
    for (const [key, text] of english) expect([key, placeholders(translated.get(key))]).toEqual([key, placeholders(text)])
  })

  it('is really written in its own script', () => {
    // A brand name, and word-order templates made only of placeholders.
    const shared = new Set(['features.Wi-Fi', 'time.clock', 'time.date'])
    for (const [key, text] of translated) {
      if (!shared.has(key)) expect([key, script.test(text)]).toEqual([key, true])
    }
  })
})

describe('coverage', () => {
  it('names every stop, class and feature', () => {
    ALL_STOPS.forEach((stop) => expect(en.stops[stop], stop).toBeTruthy())
    Object.entries(BUS_CLASSES).forEach(([cls, details]) => {
      expect(en.classes[cls]).toBeTruthy()
      details.features.forEach((feature) => expect(en.features[feature], feature).toBeTruthy())
    })
  })

  it('has text for every error code the server can send', async () => {
    const { readFileSync } = await import('node:fs')
    const source = ['server/bookings.js', 'server/auth.js', 'server/app.js', 'shared/booking-rules.js']
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    const codes = [
      ...source.matchAll(/new BookingError\(\d+, '(\w+)'/g),
      ...source.matchAll(/error: '(\w+)'/g),
      ...source.matchAll(/return '(\w+)'/g),
      ...source.matchAll(/'' : '(\w+)'/g),
    ].map((match) => match[1])
    expect(codes.length).toBeGreaterThan(15)
    codes.forEach((code) => expect(hasTranslation(`errors.${code}`), code).toBe(true))
  })

  it.each([['Sinhala', si], ['Tamil', ta], ['English', en]])('has 7 weekdays and 12 months in %s', (_, dictionary) => {
    expect(dictionary.time.weekdays.split(',')).toHaveLength(7)
    expect(dictionary.time.months.split(',')).toHaveLength(12)
  })

  it('formats dates and times without relying on browser locale data', () => {
    expect(fmtTime(new Date(2026, 10, 4, 0, 5))).toBe('12:05 AM')
    expect(fmtTime(new Date(2026, 10, 4, 12, 0))).toBe('12:00 PM')
    expect(fmtTime(new Date(2026, 10, 4, 17, 30))).toBe('5:30 PM')
    expect(fmtDate(new Date(2026, 10, 4))).toBe('Wed, 4 Nov 2026')
  })

  it('fills placeholders and falls back to the key when text is missing', () => {
    expect(translate('errors.date_out_of_range', { days: 30 })).toContain('30')
    expect(translate('errors.nothing_like_this')).toBe('errors.nothing_like_this')
    expect(translate('stops.Colombo Fort')).toBe('Colombo Fort')
  })
})
