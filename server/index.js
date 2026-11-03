import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { createPaymentGateway } from './payments.js'
import { createSmsSender } from './sms.js'

// Timetable times are Sri Lanka local time, wherever the server is hosted.
process.env.TZ = process.env.TZ || 'Asia/Colombo'

const dev = process.argv.includes('--dev')
// In dev the Vite proxy expects 3001, so a PORT set in the shell must not move the API.
const port = dev ? 3001 : Number(process.env.PORT) || 3001
const dbPath = process.env.DB_PATH || fileURLToPath(new URL('./data/buslanka.db', import.meta.url))
const distDir = fileURLToPath(new URL('../dist', import.meta.url))

let sms
let payments
try {
  // Demo mode shows login codes on screen and fakes payments, so it is never on unless asked for.
  const testServices = dev || process.env.DEMO_MODE === '1'
  sms = createSmsSender(process.env, { dev: testServices })
  payments = createPaymentGateway(process.env, { dev: testServices })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const db = openDatabase(dbPath)
const app = createApp(db, { sms, payments, maxCodesPerHour: Number(process.env.SMS_MAX_PER_HOUR) || undefined })

// Behind a hosting proxy, rate limits need the visitor's address rather than the proxy's.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY))

// After `npm run build`, this one server also serves the React app.
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res) => res.sendFile('index.html', { root: distDir }))
}

const server = app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`)
})

function shutdown() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
