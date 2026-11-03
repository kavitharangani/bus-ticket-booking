# BusLanka

App for booking bus seats online and checking when a bus will arrive. Built with React, Express and SQLite.

**Live demo: [kavitharangani.github.io/bus-ticket-booking](https://kavitharangani.github.io/bus-ticket-booking/)**

The live demo runs entirely in the browser. Bookings stay on your device, and no real SMS or payments are made.

## Run

Needs Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. This starts the React app and the API (port 3001) together.

Use `npm test` for the tests.

In `npm run dev`, no SMS is sent and no money moves. The login code appears on screen and in the terminal, and a test page replaces the payment page.

To run as one production server on http://localhost:3001, first set the SMS settings below, then:

```bash
npm run build
npm start
```

The production server won't start until an SMS provider is set, so login codes are never shown on screen. The only exception is demo mode, below.

## GitHub Pages demo

GitHub Pages can't run the server, so `npm run build:pages` builds a browser-only demo. `src/lib/demoApi.js` answers requests in place of the API, and bookings stay in the visitor's browser, so seats aren't shared between visitors. Login codes appear on screen, and no real SMS or payments are made. `.github/workflows/pages.yml` publishes it on each push to `main`.

## Deploy a demo with the real server

`DEMO_MODE=1` runs the production server without real SMS or payments: login codes appear on screen and a test page replaces the payment page. Anyone can verify any number in this mode, so use it only for demos, never for real bookings.

To deploy on [Render](https://render.com), choose **New > Blueprint** and select this repository. `render.yaml` sets up the rest. On Render's free plan, the app sleeps when idle and the first visit afterwards takes about a minute. Its disk is also temporary, so bookings are lost whenever the app restarts.

## Settings

| Variable | Needed | Purpose |
| --- | --- | --- |
| `SMS_PROVIDER` | In production | Set to `textlk` (recommended for Sri Lanka) or `twilio` |
| `TEXTLK_API_TOKEN`, `TEXTLK_SENDER_ID` | With Text.lk | API token and your approved sender ID. The demo sender is refused |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | With Twilio | Twilio account details and sender |
| `SMS_MAX_PER_HOUR` | No | Limit on codes across all numbers, to cap the SMS bill. Default 200 |
| `PAYMENT_PROVIDER` | For online payment | Set to `payhere`. If unset in production, only pay on board is offered |
| `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET` | With PayHere | From your PayHere account |
| `PUBLIC_URL` | With PayHere | Your site's public address, like `https://example.com`. PayHere must be able to reach it |
| `PAYHERE_SANDBOX` | No | Set to `1` to use PayHere's sandbox instead of real money |
| `TRUST_PROXY` | Behind a hosting proxy | Number of proxies in front of the app, so rate limits see the visitor's address |
| `DEMO_MODE` | No | Set to `1` for a demo site, as described above |
| `PORT` | No | Default 3001 |
| `DB_PATH` | No | Default `server/data/buslanka.db` |
| `TZ` | No | Default `Asia/Colombo` |

To use another SMS provider, add a sender with a `send(phone, message)` function in `server/sms.js`.

## Features

- Search buses by stop and date, and filter by class
- Pick seats on a seat map (up to 5 seats per number on each bus)
- Verify a mobile number with an SMS code before booking
- Pay online with PayHere or pay on board. Unpaid online bookings hold seats for 15 minutes
- Use the app in English, Sinhala or Tamil
- Get a ticket with a reference number, and cancel it before departure
- See your tickets on any device by verifying your number
- See upcoming buses at any stop, with estimated arrival times
- Track a bus stop by stop, with its delay and time to your stop

## Project layout

- `src/`: React app
- `server/`: Express API and SQLite database
- `shared/`: timetable, fares and rules used by both
- `src/i18n/`: English, Sinhala and Tamil text. To add a phrase, add it to all three files; a test checks this

## API

| Method and path | Purpose |
| --- | --- |
| `GET /api/availability?date=` | Number of booked seats on each bus |
| `GET /api/trips/:tripId/seats?date=` | Booked seat numbers on one bus |
| `POST /api/auth/otp/request` | Send a code to `{ phone }` |
| `POST /api/auth/otp/verify` | Check `{ phone, code }` and get a session token |
| `POST /api/auth/logout` | End the session |
| `POST /api/bookings` * | Book seats. Returns `409` with `conflicts` if a seat is gone |
| `GET /api/bookings` * | Tickets for the verified number |
| `GET /api/bookings/:ref` * | One ticket |
| `POST /api/bookings/:ref/cancel` * | Cancel a ticket |
| `POST /api/bookings/:ref/pay` * | Start or retry online payment |
| `POST /api/payments/payhere/notify` | PayHere reports a payment here, checked by its signature |
| `GET /api/config` | Whether online payment is on |

\* Needs the session token in an `Authorization: Bearer` header.

## Error messages

The API returns error codes such as `seat_taken`, and the app shows them in the visitor's language. SMS messages stay in English, as Sinhala and Tamil messages need Unicode SMS, which costs more per message.

## Payment rules

- The server sets the amount, and PayHere's notice must match it and carry a valid signature
- If a payment arrives after the hold ended, the seats are restored when free. Otherwise a refund is recorded
- Cancelling a paid ticket records a refund
- A chargeback cancels the ticket and frees the seats

## SMS code rules

- Codes have 6 digits, last 5 minutes, work once, and are stored only as hashes
- A code locks after 5 wrong tries
- Each number can ask once a minute and 5 times an hour
- Each address can ask 10 times a minute
- A verified session lasts 30 days

## Before going live

| Part | Now | To go live |
| --- | --- | --- |
| Timetable and fares | Sample values in `shared/routes.js` | Real data, with an admin screen to manage it |
| Bus location | Simulated in `src/lib/tracking.js` | GPS devices on buses |
| Payment | PayHere code is written but untested with a real account | Try it in the PayHere sandbox on a public address |
| Refunds | Recorded as `refund_due` and logged, but not paid automatically | A process and staff screen to pay them back |
| Translations | Sinhala and Tamil were written without a native review | Have a native speaker check them |
| SMS | Text.lk and Twilio senders are written but untested with real accounts | Create a Text.lk account, get a sender ID approved, and send a test code |
| Conductors | No way to check tickets | Staff login and a ticket check screen |
| Hosting | Local machine | A host with HTTPS and database backups |
