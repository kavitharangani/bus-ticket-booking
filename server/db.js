import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bookings (
    ref TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    travel_date TEXT NOT NULL,
    from_stop TEXT NOT NULL,
    to_stop TEXT NOT NULL,
    seats TEXT NOT NULL,
    passenger_name TEXT NOT NULL,
    passenger_phone TEXT NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
    created_at TEXT NOT NULL,
    cancelled_at TEXT
  );

  -- One row per occupied seat. The primary key is what stops double booking.
  CREATE TABLE IF NOT EXISTS seat_holds (
    trip_id TEXT NOT NULL,
    travel_date TEXT NOT NULL,
    seat INTEGER NOT NULL,
    booking_ref TEXT NOT NULL REFERENCES bookings (ref),
    PRIMARY KEY (trip_id, travel_date, seat)
  );

  CREATE INDEX IF NOT EXISTS seat_holds_by_booking ON seat_holds (booking_ref);
  CREATE INDEX IF NOT EXISTS bookings_by_phone ON bookings (passenger_phone);

  CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS otp_codes_by_phone ON otp_codes (phone, created_at);

  -- Only a hash of each token is stored, so a leaked database can't be used to log in.
  CREATE TABLE IF NOT EXISTS phone_sessions (
    token_hash TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`

// Added after the first release, so older databases gain them on startup.
const BOOKING_COLUMNS = {
  payment_status: "TEXT NOT NULL DEFAULT 'pay_on_board'",
  payment_expires_at: 'INTEGER',
  payment_email: 'TEXT',
  payment_attempts: 'INTEGER NOT NULL DEFAULT 0',
  payment_id: 'TEXT',
  paid_at: 'TEXT',
}

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  const existing = new Set(db.pragma('table_info(bookings)').map((column) => column.name))
  for (const [name, definition] of Object.entries(BOOKING_COLUMNS)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${definition}`)
  }
  db.exec('CREATE INDEX IF NOT EXISTS bookings_awaiting_payment ON bookings (payment_status, payment_expires_at)')
  return db
}
