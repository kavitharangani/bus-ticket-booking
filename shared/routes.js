import { atMinutes, hashString, minutesBetween } from './util.js'

// Demo timetable. Replace with an API call when a real backend exists.
export const BUS_CLASSES = {
  normal: { label: 'Normal', ratePerKm: 2.8, seats: 49, features: [] },
  semi: { label: 'Semi Luxury', ratePerKm: 4, seats: 49, features: ['Reclining seats'] },
  luxury: { label: 'Luxury AC', ratePerKm: 5.5, seats: 41, features: ['AC', 'Reclining seats'] },
  super: { label: 'Super Luxury', ratePerKm: 7, seats: 33, features: ['AC', 'Wi-Fi', 'USB charging'] },
}

const ROUTES = [
  {
    id: 'r01',
    number: '01',
    stops: [
      ['Colombo Fort', 0, 0],
      ['Kadawatha', 16, 40],
      ['Nittambuwa', 39, 75],
      ['Warakapola', 58, 105],
      ['Kegalle', 78, 135],
      ['Mawanella', 90, 155],
      ['Peradeniya', 110, 190],
      ['Kandy', 116, 205],
    ],
    out: ['05:00 normal', '06:00 luxury', '07:00 semi', '08:30 normal', '10:00 luxury', '11:30 normal', '13:00 semi', '14:30 luxury', '16:00 normal', '17:30 super', '19:00 semi', '20:30 normal'],
    back: ['04:45 semi', '06:15 normal', '07:30 luxury', '09:00 normal', '10:30 semi', '12:00 luxury', '13:30 normal', '15:00 super', '16:30 normal', '18:00 luxury', '19:30 normal'],
  },
  {
    id: 'r02',
    number: '02',
    stops: [
      ['Colombo Fort', 0, 0],
      ['Panadura', 27, 60],
      ['Kalutara', 43, 90],
      ['Aluthgama', 62, 125],
      ['Ambalangoda', 86, 165],
      ['Hikkaduwa', 99, 190],
      ['Galle', 116, 220],
      ['Weligama', 145, 265],
      ['Matara', 160, 290],
    ],
    out: ['04:30 normal', '06:00 semi', '07:30 normal', '09:00 luxury', '10:30 normal', '12:00 semi', '13:30 normal', '15:00 luxury', '16:30 normal', '18:00 semi', '20:00 normal'],
    back: ['04:00 normal', '05:30 luxury', '07:00 normal', '08:30 semi', '10:00 normal', '11:30 luxury', '13:00 normal', '14:30 semi', '16:00 normal', '18:00 normal'],
  },
  {
    id: 'ex1',
    number: 'EX1',
    stops: [
      ['Makumbura', 0, 0],
      ['Galle', 95, 70],
      ['Matara', 127, 100],
    ],
    out: ['05:30 super', '07:00 luxury', '09:00 super', '11:00 luxury', '13:00 super', '15:00 luxury', '17:00 super', '19:00 luxury', '21:00 luxury'],
    back: ['05:00 luxury', '06:30 super', '08:30 luxury', '10:30 super', '12:30 luxury', '14:30 super', '16:30 luxury', '18:30 super', '20:30 luxury'],
  },
  {
    id: 'r15',
    number: '15',
    stops: [
      ['Colombo Fort', 0, 0],
      ['Kadawatha', 16, 40],
      ['Kurunegala', 94, 150],
      ['Dambulla', 148, 235],
      ['Anuradhapura', 205, 320],
    ],
    out: ['05:15 normal', '07:15 luxury', '09:30 normal', '12:00 semi', '14:30 normal', '17:00 luxury', '21:00 semi'],
    back: ['04:30 semi', '06:30 normal', '09:00 luxury', '11:30 normal', '14:00 semi', '16:30 normal', '21:30 luxury'],
  },
  {
    id: 'r87',
    number: '87',
    stops: [
      ['Colombo Fort', 0, 0],
      ['Puttalam', 132, 210],
      ['Anuradhapura', 205, 320],
      ['Vavuniya', 260, 390],
      ['Kilinochchi', 335, 480],
      ['Jaffna', 396, 560],
    ],
    out: ['05:30 semi', '09:00 luxury', '19:30 super', '21:00 luxury', '22:30 semi'],
    back: ['05:00 luxury', '08:30 semi', '19:00 luxury', '20:30 super', '22:00 semi'],
  },
  {
    id: 'r99',
    number: '99',
    stops: [
      ['Colombo Fort', 0, 0],
      ['Avissawella', 60, 100],
      ['Ratnapura', 101, 165],
      ['Balangoda', 143, 235],
      ['Haputale', 190, 320],
      ['Bandarawela', 200, 345],
      ['Badulla', 230, 405],
    ],
    out: ['05:45 normal', '08:00 semi', '10:30 normal', '13:30 luxury', '20:00 semi', '22:00 normal'],
    back: ['05:00 semi', '07:30 normal', '10:00 luxury', '13:00 normal', '20:30 semi', '22:00 luxury'],
  },
]

function toStops(rawStops, reverse) {
  const stops = rawStops.map(([name, km, min]) => ({ name, km, min }))
  if (!reverse) return stops
  const last = stops[stops.length - 1]
  return stops.reverse().map((stop) => ({ name: stop.name, km: last.km - stop.km, min: last.min - stop.min }))
}

function buildTrip(route, departure, reverse) {
  const [time, cls] = departure.split(' ')
  const [hours, minutes] = time.split(':').map(Number)
  const id = `${route.id}-${reverse ? 'b' : 'o'}-${time.replace(':', '')}`
  const stops = toStops(route.stops, reverse)
  const hash = hashString(id)
  return {
    id,
    routeNumber: route.number,
    name: `${stops[0].name} → ${stops[stops.length - 1].name}`,
    stops,
    departMin: hours * 60 + minutes,
    cls,
    operator: hash % 2 === 0 ? 'SLTB' : 'Private',
    plate: `${['NB', 'NC', 'ND', 'NA'][hash % 4]}-${1000 + (hash % 9000)}`,
  }
}

export const TRIPS = ROUTES.flatMap((route) => [
  ...route.out.map((departure) => buildTrip(route, departure, false)),
  ...route.back.map((departure) => buildTrip(route, departure, true)),
])

const TRIPS_BY_ID = new Map(TRIPS.map((trip) => [trip.id, trip]))

export const ALL_STOPS = [...new Set(TRIPS.flatMap((trip) => trip.stops.map((stop) => stop.name)))].sort()

export function getTrip(id) {
  return TRIPS_BY_ID.get(id) ?? null
}

function stopIndex(trip, name) {
  return trip.stops.findIndex((stop) => stop.name === name)
}

export function runsBetween(trip, from, to) {
  const start = stopIndex(trip, from)
  const end = stopIndex(trip, to)
  return start !== -1 && end !== -1 && start < end
}

export function destinationsFrom(from) {
  const names = new Set()
  for (const trip of TRIPS) {
    const start = stopIndex(trip, from)
    if (start === -1) continue
    trip.stops.slice(start + 1).forEach((stop) => names.add(stop.name))
  }
  return [...names].sort()
}

export function calculateFare(cls, km) {
  return Math.max(50, Math.ceil((km * BUS_CLASSES[cls].ratePerKm) / 10) * 10)
}

// The part of a trip one passenger rides, with scheduled times on the given date.
export function getSegment(trip, from, to, dateStr) {
  if (!runsBetween(trip, from, to)) return null
  const start = trip.stops[stopIndex(trip, from)]
  const end = trip.stops[stopIndex(trip, to)]
  const departAt = atMinutes(dateStr, trip.departMin + start.min)
  const arriveAt = atMinutes(dateStr, trip.departMin + end.min)
  const km = end.km - start.km
  return {
    from,
    to,
    km,
    departAt,
    arriveAt,
    durationMin: minutesBetween(departAt, arriveAt),
    fare: calculateFare(trip.cls, km),
  }
}

export function findTrips(from, to, dateStr) {
  return TRIPS.filter((trip) => runsBetween(trip, from, to))
    .map((trip) => ({ trip, segment: getSegment(trip, from, to, dateStr) }))
    .sort((a, b) => a.segment.departAt - b.segment.departAt)
}
