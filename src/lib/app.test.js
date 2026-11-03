import { describe, expect, it } from 'vitest'
import { TRIPS, calculateFare, destinationsFrom, findTrips, getTrip } from '../../shared/routes.js'
import { validateName, validatePhone } from '../../shared/booking-rules.js'
import { arrivalsAt, simulateTrip } from './tracking.js'
import { buildSeatRows } from './bookings.js'
import { atMinutes } from '../../shared/util.js'

const DATE = '2026-11-10'

describe('timetable', () => {
  it('finds trips only in the direction of travel', () => {
    const toKandy = findTrips('Kadawatha', 'Kandy', DATE)
    expect(toKandy.length).toBeGreaterThan(0)
    toKandy.forEach(({ trip }) => expect(trip.stops.at(-1).name).toBe('Kandy'))
  })

  it('gives return trips increasing times and distances', () => {
    TRIPS.forEach((trip) => {
      expect(trip.stops[0].min).toBe(0)
      expect(trip.stops[0].km).toBe(0)
      trip.stops.slice(1).forEach((stop, index) => {
        expect(stop.min).toBeGreaterThan(trip.stops[index].min)
        expect(stop.km).toBeGreaterThan(trip.stops[index].km)
      })
    })
  })

  it('keeps every destination reachable in both directions', () => {
    destinationsFrom('Galle').forEach((stop) => expect(destinationsFrom(stop)).toContain('Galle'))
  })

  it('has unique trip ids', () => {
    expect(new Set(TRIPS.map((trip) => trip.id)).size).toBe(TRIPS.length)
  })

  it('charges more for a higher class and rounds to Rs. 10', () => {
    expect(calculateFare('luxury', 116)).toBeGreaterThan(calculateFare('normal', 116))
    expect(calculateFare('normal', 116) % 10).toBe(0)
  })
})

describe('tracking', () => {
  const trip = getTrip('r01-o-0600')

  it('moves from scheduled to running to completed', () => {
    expect(simulateTrip(trip, DATE, atMinutes(DATE, 300)).status).toBe('scheduled')
    const running = simulateTrip(trip, DATE, atMinutes(DATE, 360 + 100))
    expect(running.status).toBe('running')
    expect(running.routeProgress).toBeGreaterThan(0)
    expect(running.routeProgress).toBeLessThan(1)
    expect(simulateTrip(trip, DATE, atMinutes(DATE, 360 + 400)).status).toBe('completed')
  })

  it('does not predict delays for far-off trips', () => {
    const sim = simulateTrip(trip, DATE, atMinutes(DATE, -3000))
    expect(sim.hasForecast).toBe(false)
    expect(sim.delayMin).toBe(0)
  })

  it('never reports a bus arriving before its scheduled time', () => {
    TRIPS.forEach((item) => {
      simulateTrip(item, DATE, atMinutes(DATE, item.departMin)).stops.forEach((stop) => {
        expect(stop.delayMin).toBeGreaterThanOrEqual(0)
      })
    })
  })

  it('lists arrivals soonest first and only in the future', () => {
    const now = atMinutes(DATE, 480)
    const arrivals = arrivalsAt('Colombo Fort', { now })
    expect(arrivals.length).toBeGreaterThan(0)
    arrivals.forEach((item) => expect(item.stop.estimated > now).toBe(true))
    arrivals.slice(1).forEach((item, index) => expect(item.minutes).toBeGreaterThanOrEqual(arrivals[index].minutes))
  })

  it('includes overnight buses that left yesterday', () => {
    const now = atMinutes(DATE, 60)
    const arrivals = arrivalsAt('Vavuniya', { now })
    expect(arrivals.some((item) => item.date === '2026-11-09')).toBe(true)
  })

  it('filters arrivals by destination in the right direction', () => {
    const now = atMinutes(DATE, 480)
    arrivalsAt('Kadawatha', { goingTo: 'Kandy', now }).forEach(({ trip: item }) => {
      expect(item.stops.at(-1).name).toBe('Kandy')
    })
  })
})

describe('seats and passengers', () => {
  it.each([33, 41, 49])('lays out all %i seats', (total) => {
    const seats = buildSeatRows(total).flat().filter((seat) => seat !== null)
    expect(seats).toEqual(Array.from({ length: total }, (_, index) => index + 1))
  })

  it('validates passenger details', () => {
    expect(validatePhone('077 123 4567')).toBe('')
    expect(validatePhone('12345')).not.toBe('')
    expect(validatePhone('0112345678')).not.toBe('')
    expect(validateName('Test Passenger')).toBe('')
    expect(validateName(' ')).not.toBe('')
    expect(validateName('x'.repeat(81))).not.toBe('')
  })
})
