import { createHash, timingSafeEqual } from 'node:crypto'

function md5Upper(text) {
  return createHash('md5').update(text).digest('hex').toUpperCase()
}

function sameText(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

function createTestGateway() {
  return {
    isTest: true,
    checkout: (booking) => ({ testUrl: `/pay/test/${booking.ref}` }),
  }
}

function createPayHereGateway({ PAYHERE_MERCHANT_ID: merchantId, PAYHERE_MERCHANT_SECRET: secret, PAYHERE_SANDBOX: sandbox, PUBLIC_URL: publicUrl }) {
  if (!merchantId || !secret || !publicUrl) {
    throw new Error('PAYMENT_PROVIDER=payhere needs PAYHERE_MERCHANT_ID, PAYHERE_MERCHANT_SECRET and PUBLIC_URL.')
  }
  const siteUrl = publicUrl.replace(/\/+$/, '')
  const secretHash = md5Upper(secret)
  return {
    isTest: false,
    // The secret stays here. Only the hash made from it goes to the browser.
    checkout(booking, { orderId, email }) {
      const amount = booking.total.toFixed(2)
      const [firstName, ...others] = booking.passenger.name.split(/\s+/)
      return {
        action: sandbox === '1' ? 'https://sandbox.payhere.lk/pay/checkout' : 'https://www.payhere.lk/pay/checkout',
        fields: {
          merchant_id: merchantId,
          return_url: `${siteUrl}/tickets/${booking.ref}`,
          cancel_url: `${siteUrl}/tickets/${booking.ref}`,
          notify_url: `${siteUrl}/api/payments/payhere/notify`,
          first_name: firstName,
          last_name: others.join(' ') || firstName,
          email,
          phone: booking.passenger.phone,
          // PayHere requires an address, and a bus ticket has no delivery address to give.
          address: booking.from,
          city: booking.from,
          country: 'Sri Lanka',
          order_id: orderId,
          items: `Bus ticket ${booking.ref}`,
          currency: 'LKR',
          amount,
          hash: md5Upper(`${merchantId}${orderId}${amount}LKR${secretHash}`),
        },
      }
    },

    // Returns null unless PayHere's signature proves that this really came from PayHere.
    parseNotification(body) {
      const { merchant_id: merchant, order_id: orderId, payhere_amount: amount, payhere_currency: currency, status_code: statusCode, md5sig, payment_id: paymentId } = body ?? {}
      if (!orderId || !md5sig || merchant !== merchantId) return null
      const expected = md5Upper(`${merchant}${orderId}${amount}${currency}${statusCode}${secretHash}`)
      if (!sameText(expected, md5sig)) return null
      return { orderId, amount: Number(amount), currency, statusCode: Number(statusCode), paymentId }
    },
  }
}

// Online payment is optional: with no provider set, the site offers pay on board only.
export function createPaymentGateway(env, { dev }) {
  const provider = env.PAYMENT_PROVIDER || (dev ? 'test' : '')
  if (!provider) return null
  if (provider === 'test' && dev) return createTestGateway()
  if (provider === 'payhere') return createPayHereGateway(env)
  throw new Error('PAYMENT_PROVIDER must be payhere in production, or left unset for pay on board only.')
}
