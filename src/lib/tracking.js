import { TRIPS } from '../../shared/routes.js'
import { addDays, atMinutes, hashString, minutesBetween, seededRandom, toDateStr } from '../../shared/util.js'

const FORECAST_WINDOW_MS = 3 * 60 * 60000

// Stands in for GPS: position comes from the timetable plus a repeatable delay for each trip and date.
export function simulateTrip(trip, dateStr, now = new Date()) {
  const random = seededRandom(hashString(`${trip.id}|${dateStr}`))
  const startDelayMin = Math.floor(random() * 16)
  const slowdown = 1 + random() * 0.12
  const start = atMinutes(dateStr, trip.departMin)
  const hasForecast = now - start >= -FORECAST_WINDOW_MS

  const stops = trip.stops.map((stop) => {
    const scheduled = atMinutes(dateStr, trip.departMin + stop.min)
    const estimated = hasForecast
      ? atMinutes(dateStr, trip.departMin + startDelayMin + Math.round(stop.min * slowdown))
      : scheduled
    return { name: stop.name, km: stop.km, scheduled, estimated, delayMin: minutesBetween(scheduled, estimated) }
  })

  const first = stops[0]
  const last = stops[stops.length - 1]
  const nextIndex = stops.findIndex((stop) => stop.estimated > now)

  if (now < first.estimated) {
    return { status: 'scheduled', stops, hasForecast, nextIndex: 0, segmentProgress: 0, routeProgress: 0, delayMin: first.delayMin }
  }
  if (now >= last.estimated) {
    return { status: 'completed', stops, hasForecast, nextIndex: -1, segmentProgress: 1, routeProgress: 1, delayMin: last.delayMin }
  }

  const previous = stops[nextIndex - 1]
  const next = stops[nextIndex]
  const segmentProgress = (now - previous.estimated) / (next.estimated - previous.estimated)
  const km = previous.km + (next.km - previous.km) * segmentProgress
  return { status: 'running', stops, hasForecast, nextIndex, segmentProgress, routeProgress: km / last.km, delayMin: next.delayMin }
}

export function stopOf(sim, stopName) {
  return sim.stops.find((stop) => stop.name === stopName) ?? null
}

// Buses reaching a stop soon. Yesterday's trips count, because overnight buses are still on the road.
export function arrivalsAt(stopName, { goingTo = '', now = new Date(), windowMin = 360 } = {}) {
  const dates = [toDateStr(addDays(now, -1)), toDateStr(now)]
  const arrivals = []
  for (const date of dates) {
    for (const trip of TRIPS) {
      const index = trip.stops.findIndex((stop) => stop.name === stopName)
      if (index === -1) continue
      if (goingTo && !trip.stops.slice(index + 1).some((stop) => stop.name === goingTo)) continue
      const sim = simulateTrip(trip, date, now)
      const stop = sim.stops[index]
      const minutes = (stop.estimated - now) / 60000
      if (minutes <= 0 || minutes > windowMin) continue
      arrivals.push({
        trip,
        date,
        sim,
        stop,
        minutes: Math.ceil(minutes),
        endsHere: index === trip.stops.length - 1,
      })
    }
  }
  return arrivals.sort((a, b) => a.minutes - b.minutes)
}
