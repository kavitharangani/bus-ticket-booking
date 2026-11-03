function createConsoleSender() {
  return {
    exposesCode: true,
    async send(phone, message) {
      console.log(`[sms to ${phone}] ${message}`)
    },
  }
}

function createTwilioSender({ TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from }) {
  if (!sid || !token || !from) {
    throw new Error('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.')
  }
  const authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`
  return {
    exposesCode: false,
    async send(phone, message) {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: authorization },
        body: new URLSearchParams({ To: `+94${phone.slice(1)}`, From: from, Body: message }),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error(`Twilio responded with status ${response.status}`)
    },
  }
}

function createTextLkSender({ TEXTLK_API_TOKEN: token, TEXTLK_SENDER_ID: senderId }) {
  if (!token || !senderId) {
    throw new Error('SMS_PROVIDER=textlk needs TEXTLK_API_TOKEN and TEXTLK_SENDER_ID.')
  }
  // Text.lk says login codes sent from its demo sender can get an account suspended.
  if (senderId.toLowerCase() === 'textlkdemo') {
    throw new Error('TEXTLK_SENDER_ID must be your own approved sender ID, not the demo one.')
  }
  return {
    exposesCode: false,
    async send(phone, message) {
      const response = await fetch('https://app.text.lk/api/v3/sms/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ recipient: `94${phone.slice(1)}`, sender_id: senderId, type: 'plain', message }),
        signal: AbortSignal.timeout(10000),
      })
      // The docs report failures through the `status` field, so a 200 alone doesn't prove it worked.
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.status !== 'success') {
        throw new Error(`Text.lk responded with status ${response.status}: ${result?.message ?? 'no details'}`)
      }
    },
  }
}

// The console sender shows codes to anyone, so it only ever runs in dev mode.
export function createSmsSender(env, { dev }) {
  const provider = env.SMS_PROVIDER || (dev ? 'console' : '')
  if (provider === 'console' && dev) return createConsoleSender()
  if (provider === 'textlk') return createTextLkSender(env)
  if (provider === 'twilio') return createTwilioSender(env)
  throw new Error('Set SMS_PROVIDER to textlk or twilio to run in production, so that login codes reach real phones.')
}
