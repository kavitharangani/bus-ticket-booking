import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { openDatabase } from './db.js'
import { createPaymentGateway } from './payments.js'
import { createSmsSender } from './sms.js'

const NOW = new Date(2026, 10, 10, 8, 0)
const DATE = '2026-11-11'
const PHONE = '0771234567'
const BODY = { tripId: 'r01-o-0600', date: DATE, from: 'Colombo Fort', to: 'Kandy', seats: [3, 4], name: 'Test Passenger' }
const MINUTE = 60000

let db
let server
let base
let clock
let sent
let smsFails

function post(path, body, token) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

function get(path, token) {
  return fetch(base + path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
}

function lastCode() {
  return /\b(\d{6})\b/.exec(sent.at(-1).message)[1]
}

function wrongCode() {
  return lastCode() === '000000' ? '000001' : '000000'
}

async function requestCode(phone = PHONE) {
  return post('/auth/otp/request', { phone })
}

async function login(phone = PHONE) {
  expect((await requestCode(phone)).status).toBe(200)
  const response = await post('/auth/otp/verify', { phone, code: lastCode() })
  expect(response.status).toBe(200)
  return (await response.json()).token
}

async function takenSeats() {
  return (await (await get(`/trips/r01-o-0600/seats?date=${DATE}`)).json()).taken
}

beforeEach(async () => {
  clock = NOW
  sent = []
  smsFails = false
  db = openDatabase(':memory:')
  const sms = {
    async send(phone, message) {
      if (smsFails) throw new Error('gateway down')
      sent.push({ phone, message })
    },
  }
  server = createApp(db, { now: () => clock, sms, maxCodesPerHour: 8 }).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/api`
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
})

describe('phone verification', () => {
  it('sends a code by SMS and never returns it in production mode', async () => {
    const response = await requestCode('077-123 4567')
    expect(response.status).toBe(200)
    expect(sent[0].phone).toBe(PHONE)
    expect(await response.json()).toEqual({ expiresInSeconds: 300, resendInSeconds: 60 })
  })

  it('does not store the code in plain text', async () => {
    await requestCode()
    expect(db.prepare('SELECT code_hash FROM otp_codes').get().code_hash).not.toContain(lastCode())
  })

  it.each(['12345', '0112345678', '', null])('rejects non-mobile number %s', async (phone) => {
    expect((await post('/auth/otp/request', { phone })).status).toBe(400)
    expect(sent).toHaveLength(0)
  })

  it('makes people wait before asking for another code', async () => {
    await requestCode()
    const tooSoon = await requestCode()
    expect(tooSoon.status).toBe(429)
    expect((await tooSoon.json()).resendInSeconds).toBe(60)
    clock = new Date(NOW.getTime() + MINUTE)
    expect((await requestCode()).status).toBe(200)
    expect(sent).toHaveLength(2)
  })

  it('limits codes per number each hour', async () => {
    for (let i = 0; i < 5; i++) {
      clock = new Date(NOW.getTime() + i * 2 * MINUTE)
      expect((await requestCode()).status).toBe(200)
    }
    clock = new Date(NOW.getTime() + 20 * MINUTE)
    expect((await requestCode()).status).toBe(429)
    clock = new Date(NOW.getTime() + 70 * MINUTE)
    expect((await requestCode()).status).toBe(200)
  })

  it('stops sending once the hourly limit across all numbers is reached', async () => {
    for (let i = 0; i < 8; i++) expect((await requestCode(`07700000${10 + i}`)).status).toBe(200)
    expect((await requestCode('0770000099')).status).toBe(503)
    expect(sent).toHaveLength(8)
  })

  it('limits SMS requests from one address', async () => {
    const statuses = []
    for (let i = 0; i < 11; i++) statuses.push((await requestCode(`07711111${10 + i}`)).status)
    expect(statuses.at(-1)).toBe(429)
    expect(sent.length).toBeLessThanOrEqual(10)
  })

  it('lets people retry straight away when the SMS fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    smsFails = true
    expect((await requestCode()).status).toBe(502)
    smsFails = false
    expect((await requestCode()).status).toBe(200)
    error.mockRestore()
  })

  it('accepts the right code only once', async () => {
    await requestCode()
    const code = lastCode()
    const first = await post('/auth/otp/verify', { phone: PHONE, code })
    expect(first.status).toBe(200)
    const session = await first.json()
    expect(session.phone).toBe(PHONE)
    expect(session.token.length).toBeGreaterThan(30)
    expect((await post('/auth/otp/verify', { phone: PHONE, code })).status).toBe(400)
  })

  it('rejects an expired code', async () => {
    await requestCode()
    clock = new Date(NOW.getTime() + 5 * MINUTE)
    expect((await post('/auth/otp/verify', { phone: PHONE, code: lastCode() })).status).toBe(400)
  })

  it('rejects a code sent to a different number', async () => {
    await requestCode()
    expect((await post('/auth/otp/verify', { phone: '0712345678', code: lastCode() })).status).toBe(400)
  })

  it('locks a code after five wrong tries, even if the sixth is right', async () => {
    await requestCode()
    for (let left = 4; left >= 0; left--) {
      const response = await post('/auth/otp/verify', { phone: PHONE, code: wrongCode() })
      expect(response.status).toBe(400)
      expect((await response.json()).attemptsLeft).toBe(left)
    }
    expect((await post('/auth/otp/verify', { phone: PHONE, code: lastCode() })).status).toBe(429)
  })

  it('stops an old code working once a new one is sent', async () => {
    await requestCode()
    const oldCode = lastCode()
    clock = new Date(NOW.getTime() + MINUTE)
    await requestCode()
    if (oldCode !== lastCode()) {
      expect((await post('/auth/otp/verify', { phone: PHONE, code: oldCode })).status).toBe(400)
    }
    expect((await post('/auth/otp/verify', { phone: PHONE, code: lastCode() })).status).toBe(200)
  })

  it('ends a session on logout and when it expires', async () => {
    const token = await login()
    expect((await get('/bookings', token)).status).toBe(200)
    clock = new Date(NOW.getTime() + 31 * 24 * 60 * MINUTE)
    expect((await get('/bookings', token)).status).toBe(401)

    clock = NOW
    expect((await get('/bookings', token)).status).toBe(200)
    await post('/auth/logout', {}, token)
    expect((await get('/bookings', token)).status).toBe(401)
  })
})

describe('creating bookings', () => {
  it.each([
    ['no token', undefined],
    ['a made-up token', 'made-up-token'],
  ])('refuses a booking with %s', async (_, token) => {
    expect((await post('/bookings', BODY, token)).status).toBe(401)
    expect(await takenSeats()).toEqual([])
  })

  it('books under the verified number, ignoring any number in the request', async () => {
    const token = await login()
    const response = await post('/bookings', { ...BODY, total: 1, phone: '0700000000', passenger: { phone: '0700000000' } }, token)
    expect(response.status).toBe(201)
    const booking = await response.json()
    expect(booking.ref).toMatch(/^BL[A-Z2-9]{6}$/)
    expect(booking.total).toBe(1280)
    expect(booking.passenger).toEqual({ name: 'Test Passenger', phone: PHONE })
    expect(await takenSeats()).toEqual([3, 4])
    const availability = await (await get(`/availability?date=${DATE}`)).json()
    expect(availability.taken['r01-o-0600']).toBe(2)
  })

  it('never sells one seat twice, even when requests arrive together', async () => {
    const token = await login()
    const responses = await Promise.all(Array.from({ length: 10 }, () => post('/bookings', { ...BODY, seats: [7] }, token)))
    const statuses = responses.map((response) => response.status)
    expect(statuses.filter((status) => status === 201)).toHaveLength(1)
    expect(statuses.filter((status) => status === 409)).toHaveLength(9)
  })

  it('reports exactly which seats clash and books none of them', async () => {
    const first = await login()
    await post('/bookings', { ...BODY, seats: [4] }, first)
    const second = await login('0712345678')
    const response = await post('/bookings', { ...BODY, seats: [3, 4] }, second)
    expect(response.status).toBe(409)
    expect((await response.json()).conflicts).toEqual([4])
    expect(await takenSeats()).toEqual([4])
  })

  it('limits one number to five seats on a bus, and cancelling frees the allowance', async () => {
    const token = await login()
    const first = await (await post('/bookings', { ...BODY, seats: [1, 2, 3, 4] }, token)).json()
    expect((await post('/bookings', { ...BODY, seats: [5, 6] }, token)).status).toBe(409)
    expect((await post('/bookings', { ...BODY, seats: [5] }, token)).status).toBe(201)
    await post(`/bookings/${first.ref}/cancel`, {}, token)
    expect((await post('/bookings', { ...BODY, seats: [6, 7] }, token)).status).toBe(201)
  })

  it('keeps seats separate for each date and bus', async () => {
    const token = await login()
    await post('/bookings', BODY, token)
    expect((await post('/bookings', { ...BODY, date: '2026-11-12' }, token)).status).toBe(201)
    expect((await post('/bookings', { ...BODY, tripId: 'r01-o-0700' }, token)).status).toBe(201)
  })

  it.each([
    ['unknown bus', { tripId: 'nope' }, 404],
    ['wrong direction', { from: 'Kandy', to: 'Colombo Fort' }, 400],
    ['bad date', { date: '2026-13-45' }, 400],
    ['past date', { date: '2026-11-09' }, 400],
    ['too far ahead', { date: '2026-12-25' }, 400],
    ['departed bus', { date: '2026-11-10', tripId: 'r01-o-0500' }, 409],
    ['no seats', { seats: [] }, 400],
    ['six seats', { seats: [1, 2, 3, 4, 5, 6] }, 400],
    ['duplicate seats', { seats: [2, 2] }, 400],
    ['seat out of range', { seats: [999] }, 400],
    ['seat as text', { seats: ['1'] }, 400],
    ['no name', { name: ' ' }, 400],
  ])('rejects %s', async (_, change, status) => {
    const token = await login()
    const response = await post('/bookings', { ...BODY, ...change }, token)
    expect(response.status).toBe(status)
    expect((await response.json()).error).toBeTruthy()
  })

  it('answers malformed JSON with a clean error', async () => {
    const response = await fetch(`${base}/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })
})

describe('tickets', () => {
  it('lists every ticket for the verified number, from any device', async () => {
    const firstDevice = await login()
    const { ref } = await (await post('/bookings', BODY, firstDevice)).json()
    clock = new Date(NOW.getTime() + MINUTE)
    const secondDevice = await login()
    const { bookings } = await (await get('/bookings', secondDevice)).json()
    expect(bookings.map((booking) => booking.ref)).toEqual([ref])
    expect((await get(`/bookings/${ref.toLowerCase()}`, secondDevice)).status).toBe(200)
  })

  it('hides tickets from other numbers and from visitors with no session', async () => {
    const owner = await login()
    const { ref } = await (await post('/bookings', BODY, owner)).json()
    const other = await login('0712345678')
    expect((await get(`/bookings/${ref}`, other)).status).toBe(404)
    expect((await (await get('/bookings', other)).json()).bookings).toEqual([])
    expect((await get(`/bookings/${ref}`)).status).toBe(401)
    expect((await get('/bookings')).status).toBe(401)
  })

  it('frees the seats after cancelling, and a repeat cancel is harmless', async () => {
    const token = await login()
    const { ref } = await (await post('/bookings', BODY, token)).json()
    const cancelled = await post(`/bookings/${ref}/cancel`, {}, token)
    expect((await cancelled.json()).status).toBe('cancelled')
    expect(await takenSeats()).toEqual([])
    expect((await post(`/bookings/${ref}/cancel`, {}, token)).status).toBe(200)
    expect((await post('/bookings', BODY, token)).status).toBe(201)
  })

  it('will not cancel for another number or without a session', async () => {
    const owner = await login()
    const { ref } = await (await post('/bookings', BODY, owner)).json()
    const other = await login('0712345678')
    expect((await post(`/bookings/${ref}/cancel`, {}, other)).status).toBe(404)
    expect((await post(`/bookings/${ref}/cancel`, {})).status).toBe(401)
    expect(await takenSeats()).toEqual([3, 4])
  })

  it('will not cancel after the bus has left', async () => {
    const token = await login()
    const { ref } = await (await post('/bookings', BODY, token)).json()
    clock = new Date(2026, 10, 11, 7, 0)
    expect((await post(`/bookings/${ref}/cancel`, {}, token)).status).toBe(409)
  })
})

describe('SMS senders', () => {
  it('shows codes on screen only in dev mode', () => {
    expect(createSmsSender({}, { dev: true }).exposesCode).toBe(true)
    expect(() => createSmsSender({}, { dev: false })).toThrow(/SMS_PROVIDER/)
    expect(() => createSmsSender({ SMS_PROVIDER: 'console' }, { dev: false })).toThrow(/SMS_PROVIDER/)
  })

  it('refuses to start Twilio without its settings', () => {
    expect(() => createSmsSender({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1' }, { dev: false })).toThrow(/TWILIO_AUTH_TOKEN/)
  })

  it('sends to Twilio in international format', async () => {
    const fetchStub = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchStub)
    const sender = createSmsSender(
      { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'secret', TWILIO_FROM: '+15550001111' },
      { dev: false },
    )
    await sender.send(PHONE, 'hello')
    vi.unstubAllGlobals()
    const [url, options] = fetchStub.mock.calls[0]
    expect(url).toContain('/Accounts/AC1/Messages.json')
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('AC1:secret').toString('base64')}`)
    expect(Object.fromEntries(options.body)).toEqual({ To: '+94771234567', From: '+15550001111', Body: 'hello' })
    expect(sender.exposesCode).toBe(false)
  })

  describe('Text.lk', () => {
    const ENV = { SMS_PROVIDER: 'textlk', TEXTLK_API_TOKEN: 'secret', TEXTLK_SENDER_ID: 'BusLanka' }

    function stubResponse(response) {
      const fetchStub = vi.fn(async () => response)
      vi.stubGlobal('fetch', fetchStub)
      return fetchStub
    }

    afterEach(() => vi.unstubAllGlobals())

    it('refuses to start without its settings or with the demo sender', () => {
      expect(() => createSmsSender({ SMS_PROVIDER: 'textlk', TEXTLK_API_TOKEN: 'secret' }, { dev: false })).toThrow(/TEXTLK_SENDER_ID/)
      expect(() => createSmsSender({ ...ENV, TEXTLK_SENDER_ID: 'TextLKDemo' }, { dev: false })).toThrow(/demo/)
    })

    it('sends the documented request and never exposes the code', async () => {
      const fetchStub = stubResponse({ ok: true, status: 200, json: async () => ({ status: 'success' }) })
      const sender = createSmsSender(ENV, { dev: false })
      await sender.send(PHONE, 'hello')
      const [url, options] = fetchStub.mock.calls[0]
      expect(url).toBe('https://app.text.lk/api/v3/sms/send')
      expect(options.method).toBe('POST')
      expect(options.headers.Authorization).toBe('Bearer secret')
      expect(JSON.parse(options.body)).toEqual({ recipient: '94771234567', sender_id: 'BusLanka', type: 'plain', message: 'hello' })
      expect(sender.exposesCode).toBe(false)
    })

    it.each([
      ['an error status inside a 200 response', { ok: true, status: 200, json: async () => ({ status: 'error', message: 'Low balance' }) }, 'Low balance'],
      ['an HTTP error', { ok: false, status: 401, json: async () => ({ status: 'error', message: 'Unauthenticated' }) }, 'Unauthenticated'],
      ['a response that is not JSON', { ok: true, status: 200, json: async () => { throw new Error('bad json') } }, 'no details'],
    ])('treats %s as a failure', async (_, response, expected) => {
      stubResponse(response)
      await expect(createSmsSender(ENV, { dev: false }).send(PHONE, 'hello')).rejects.toThrow(expected)
    })

    it('does not put the token in error messages', async () => {
      stubResponse({ ok: false, status: 500, json: async () => ({ status: 'error', message: 'Server error' }) })
      const failure = await createSmsSender(ENV, { dev: false }).send(PHONE, 'hello').catch((error) => error)
      expect(failure.message).not.toContain('secret')
    })
  })

  it('reports a Twilio failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))
    const sender = createSmsSender(
      { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'secret', TWILIO_FROM: '+15550001111' },
      { dev: false },
    )
    await expect(sender.send(PHONE, 'hello')).rejects.toThrow('401')
    vi.unstubAllGlobals()
  })
})

describe('online payment', () => {
  const ENV = { PAYMENT_PROVIDER: 'payhere', PAYHERE_MERCHANT_ID: '1211149', PAYHERE_MERCHANT_SECRET: 'test-secret', PAYHERE_SANDBOX: '1', PUBLIC_URL: 'https://bus.example.com/' }
  const ONLINE = { ...BODY, paymentMethod: 'online', email: 'test@example.com' }
  const upperMd5 = (text) => createHash('md5').update(text).digest('hex').toUpperCase()

  function signedNotice({ orderId, amount = '1280.00', currency = 'LKR', status = '2', secret = ENV.PAYHERE_MERCHANT_SECRET }) {
    return new URLSearchParams({
      merchant_id: ENV.PAYHERE_MERCHANT_ID,
      order_id: orderId,
      payment_id: '320025',
      payhere_amount: amount,
      payhere_currency: currency,
      status_code: status,
      md5sig: upperMd5(`${ENV.PAYHERE_MERCHANT_ID}${orderId}${amount}${currency}${status}${upperMd5(secret)}`),
    })
  }

  function notify(body) {
    return fetch(`${base}/payments/payhere/notify`, { method: 'POST', body })
  }

  async function startApp(env = ENV, { dev = false } = {}) {
    await new Promise((resolve) => server.close(resolve))
    const sms = { async send(phone, message) { sent.push({ phone, message }) } }
    server = createApp(db, { now: () => clock, sms, payments: createPaymentGateway(env, { dev }) }).listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${server.address().port}/api`
  }

  async function ticket(ref, token) {
    return (await get(`/bookings/${ref}`, token)).json()
  }

  async function bookOnline(token, body = ONLINE) {
    const response = await post('/bookings', body, token)
    expect(response.status).toBe(201)
    return response.json()
  }

  beforeEach(() => startApp())

  it('keeps pay on board working as the default', async () => {
    const token = await login()
    const booking = await (await post('/bookings', BODY, token)).json()
    expect(booking.payment).toEqual({ status: 'pay_on_board', expiresAt: null })
    expect((await post(`/bookings/${booking.ref}/pay`, {}, token)).status).toBe(409)
  })

  it('offers online payment only when a gateway is set', async () => {
    expect((await (await get('/config')).json()).onlinePayment).toBe(true)
    await startApp({})
    expect((await (await get('/config')).json()).onlinePayment).toBe(false)
    const token = await login()
    const response = await post('/bookings', ONLINE, token)
    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe('payment_unavailable')
    expect(await takenSeats()).toEqual([])
  })

  it('needs a valid email and a known payment method', async () => {
    const token = await login()
    expect((await post('/bookings', { ...ONLINE, email: 'nope' }, token)).status).toBe(400)
    expect((await post('/bookings', { ...BODY, paymentMethod: 'cash-app' }, token)).status).toBe(400)
  })

  it('holds the seats for 15 minutes while waiting for payment', async () => {
    const token = await login()
    const booking = await bookOnline(token)
    expect(booking.payment).toEqual({ status: 'awaiting', expiresAt: NOW.getTime() + 15 * MINUTE })
    expect(await takenSeats()).toEqual([3, 4])

    clock = new Date(NOW.getTime() + 15 * MINUTE)
    expect(await takenSeats()).toEqual([])
    const expired = await ticket(booking.ref, token)
    expect(expired.status).toBe('cancelled')
    expect(expired.payment.status).toBe('expired')
    expect((await post(`/bookings/${booking.ref}/pay`, {}, token)).status).toBe(409)
  })

  it('never holds a seat past departure', async () => {
    const token = await login()
    clock = new Date(2026, 10, 11, 5, 55)
    await post('/auth/otp/request', { phone: PHONE })
    const booking = await bookOnline(token)
    expect(booking.payment.expiresAt).toBe(new Date(2026, 10, 11, 6, 0).getTime())
  })

  it('builds a correctly signed checkout without revealing the secret', async () => {
    const token = await login()
    const { ref } = await bookOnline(token)
    const response = await post(`/bookings/${ref}/pay`, {}, token)
    expect(response.status).toBe(200)
    const raw = await response.text()
    expect(raw).not.toContain(ENV.PAYHERE_MERCHANT_SECRET)
    const { action, fields } = JSON.parse(raw)
    expect(action).toBe('https://sandbox.payhere.lk/pay/checkout')
    expect(fields.amount).toBe('1280.00')
    expect(fields.order_id).toBe(`${ref}-1`)
    expect(fields.email).toBe('test@example.com')
    expect(fields.notify_url).toBe('https://bus.example.com/api/payments/payhere/notify')
    expect(fields.hash).toBe(upperMd5(`${ENV.PAYHERE_MERCHANT_ID}${ref}-11280.00LKR${upperMd5(ENV.PAYHERE_MERCHANT_SECRET)}`))
    const again = await (await post(`/bookings/${ref}/pay`, {}, token)).json()
    expect(again.fields.order_id).toBe(`${ref}-2`)
  })

  it('uses the live address unless sandbox is on', async () => {
    await startApp({ ...ENV, PAYHERE_SANDBOX: '' })
    const token = await login()
    const { ref } = await bookOnline(token)
    expect((await (await post(`/bookings/${ref}/pay`, {}, token)).json()).action).toBe('https://www.payhere.lk/pay/checkout')
  })

  it('marks a ticket paid when PayHere confirms, and repeats are harmless', async () => {
    const token = await login()
    const { ref } = await bookOnline(token)
    expect((await notify(signedNotice({ orderId: `${ref}-1` }))).status).toBe(200)
    expect((await ticket(ref, token)).payment.status).toBe('paid')
    expect((await notify(signedNotice({ orderId: `${ref}-1` }))).status).toBe(200)
    expect((await ticket(ref, token)).payment.status).toBe('paid')

    clock = new Date(NOW.getTime() + 20 * MINUTE)
    expect(await takenSeats()).toEqual([3, 4])
  })

  it('ignores forged, tampered and underpaid notices', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const token = await login()
    const { ref } = await bookOnline(token)
    expect((await notify(signedNotice({ orderId: `${ref}-1`, secret: 'wrong' }))).status).toBe(400)
    const tampered = signedNotice({ orderId: `${ref}-1`, status: '-2' })
    tampered.set('status_code', '2')
    expect((await notify(tampered)).status).toBe(400)
    await notify(signedNotice({ orderId: `${ref}-1`, amount: '1.00' }))
    await notify(signedNotice({ orderId: `${ref}-1`, currency: 'USD' }))
    expect((await ticket(ref, token)).payment.status).toBe('awaiting')
    error.mockRestore()
  })

  it('leaves the ticket open for another try after a failed payment', async () => {
    const token = await login()
    const { ref } = await bookOnline(token)
    await notify(signedNotice({ orderId: `${ref}-1`, status: '-2' }))
    expect((await ticket(ref, token)).payment.status).toBe('awaiting')
    expect((await post(`/bookings/${ref}/pay`, {}, token)).status).toBe(200)
  })

  it('restores seats when a late payment arrives and they are still free', async () => {
    const token = await login()
    const { ref } = await bookOnline(token)
    clock = new Date(NOW.getTime() + 16 * MINUTE)
    await notify(signedNotice({ orderId: `${ref}-1` }))
    const restored = await ticket(ref, token)
    expect(restored.status).toBe('confirmed')
    expect(restored.payment.status).toBe('paid')
    expect(await takenSeats()).toEqual([3, 4])
  })

  it('records a refund when a late payment arrives and the seats have gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const token = await login()
    const { ref } = await bookOnline(token)
    clock = new Date(NOW.getTime() + 16 * MINUTE)
    const other = await login('0712345678')
    await post('/bookings', { ...BODY, seats: [4] }, other)
    await notify(signedNotice({ orderId: `${ref}-1` }))
    const late = await ticket(ref, token)
    expect(late.status).toBe('cancelled')
    expect(late.payment.status).toBe('refund_due')
    expect(await takenSeats()).toEqual([4])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(ref))
    warn.mockRestore()
  })

  it('records a refund when a paid ticket is cancelled, and none when unpaid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const token = await login()
    const paid = await bookOnline(token)
    await notify(signedNotice({ orderId: `${paid.ref}-1` }))
    expect((await (await post(`/bookings/${paid.ref}/cancel`, {}, token)).json()).payment.status).toBe('refund_due')
    const unpaid = await bookOnline(token)
    expect((await (await post(`/bookings/${unpaid.ref}/cancel`, {}, token)).json()).payment.status).toBe('not_paid')
    expect(await takenSeats()).toEqual([])
    warn.mockRestore()
  })

  it('cancels the ticket and frees the seats on a chargeback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const token = await login()
    const { ref } = await bookOnline(token)
    await notify(signedNotice({ orderId: `${ref}-1` }))
    await notify(signedNotice({ orderId: `${ref}-1`, status: '-3' }))
    const charged = await ticket(ref, token)
    expect(charged.status).toBe('cancelled')
    expect(charged.payment.status).toBe('chargedback')
    expect(await takenSeats()).toEqual([])
    warn.mockRestore()
  })

  it('never exposes the test payment route with a real gateway', async () => {
    const token = await login()
    const { ref } = await bookOnline(token)
    expect((await post(`/payments/test/${ref}`, { outcome: 'success' }, token)).status).toBe(404)
    expect((await ticket(ref, token)).payment.status).toBe('awaiting')
  })

  it('lets the test gateway pay only for your own ticket, in dev only', async () => {
    await startApp({}, { dev: true })
    const token = await login()
    const { ref } = await bookOnline(token)
    expect((await (await post(`/bookings/${ref}/pay`, {}, token)).json()).testUrl).toBe(`/pay/test/${ref}`)
    const other = await login('0712345678')
    expect((await post(`/payments/test/${ref}`, { outcome: 'success' }, other)).status).toBe(404)
    await post(`/payments/test/${ref}`, { outcome: 'fail' }, token)
    expect((await ticket(ref, token)).payment.status).toBe('awaiting')
    await post(`/payments/test/${ref}`, { outcome: 'success' }, token)
    expect((await ticket(ref, token)).payment.status).toBe('paid')
  })

  it('checks gateway settings at startup', () => {
    expect(createPaymentGateway({}, { dev: false })).toBe(null)
    expect(createPaymentGateway({}, { dev: true }).isTest).toBe(true)
    expect(() => createPaymentGateway({ PAYMENT_PROVIDER: 'test' }, { dev: false })).toThrow(/PAYMENT_PROVIDER/)
    expect(() => createPaymentGateway({ PAYMENT_PROVIDER: 'payhere' }, { dev: false })).toThrow(/PAYHERE_MERCHANT_ID/)
  })
})
