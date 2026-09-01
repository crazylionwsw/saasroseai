import { describe, it, expect } from 'vitest'

const WEBHOOK_SECRET = 'whsec_test_secret'
const ORDER_ID = 'ORD-20260831-TEST'

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function buildSignedRequest(body: any): Promise<Request> {
  const raw = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  const signedPayload = `${timestamp}.${raw}`
  return hmacHex(WEBHOOK_SECRET, signedPayload).then((sig) => {
    return new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${sig}` },
      body: raw,
    })
  })
}

function createWebhookEnv() {
  let eventInserts = 0
  let paymentsUpdated = 0
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('FROM orders WHERE id = ? AND merchant_id = ?')) {
            return { id: ORDER_ID, merchant_id: 'm-1', status: 'pending_payment', payment_status: 'pending' }
          }
          return null
        },
        run: async () => {
          if (sql.includes('INSERT INTO payment_events')) {
            eventInserts += 1
            return { success: true, meta: { changes: eventInserts === 1 ? 1 : 0 } }
          }
          if (sql.includes('UPDATE payments')) paymentsUpdated += 1
          return { success: true, meta: { changes: 1 } }
        },
        all: async () => ({ results: [] }),
      }),
    }),
  }
  return {
    MERCHANT_DB: db,
    MERCHANT_ID: 'm-1',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    _eventInserts: () => eventInserts,
    _paymentsUpdated: () => paymentsUpdated,
  } as any
}

describe('Stripe Webhook - Signature Verification & Idempotency', () => {
  it('rejects a webhook without a signature header', async () => {
    const { handleStripeWebhook } = await import('../merchant-template/worker/src/payment')
    const env = createWebhookEnv()
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      body: JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: {} }),
    })
    const resp = await handleStripeWebhook(req, env)
    expect(resp.status).toBe(400)
  })

  it('rejects a webhook with an invalid signature', async () => {
    const { handleStripeWebhook } = await import('../merchant-template/worker/src/payment')
    const env = createWebhookEnv()
    const timestamp = Math.floor(Date.now() / 1000)
    const raw = JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed' })
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=deadbeef` },
      body: raw,
    })
    const resp = await handleStripeWebhook(req, env)
    expect(resp.status).toBe(400)
    expect(env._eventInserts()).toBe(0)
  })

  it('processes a valid webhook and marks the order paid', async () => {
    const { handleStripeWebhook } = await import('../merchant-template/worker/src/payment')
    const env = createWebhookEnv()
    const req = await buildSignedRequest({
      id: 'evt_ok',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test',
          payment_status: 'paid',
          client_reference_id: ORDER_ID,
          metadata: { order_id: ORDER_ID },
        },
      },
    })
    const resp = await handleStripeWebhook(req, env)
    expect(resp.status).toBe(200)
    const data: any = await resp.json()
    expect(data.received).toBe(true)
    expect(env._eventInserts()).toBe(1)
    expect(env._paymentsUpdated()).toBe(1)
  })

  it('is idempotent - duplicate webhook does not reprocess', async () => {
    const { handleStripeWebhook } = await import('../merchant-template/worker/src/payment')
    const env = createWebhookEnv()
    const build = () =>
      buildSignedRequest({
        id: 'evt_dup',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_dup',
            payment_status: 'paid',
            client_reference_id: ORDER_ID,
            metadata: { order_id: ORDER_ID },
          },
        },
      })

    const first = await handleStripeWebhook(await build(), env)
    expect(first.status).toBe(200)
    const dup = await handleStripeWebhook(await build(), env)
    const dupData: any = await dup.json()
    expect(dup.status).toBe(200)
    expect(dupData.duplicate).toBe(true)
    expect(env._eventInserts()).toBe(2) // insert attempted twice, second deduped
    expect(env._paymentsUpdated()).toBe(1) // payment/order updated only once
  })
})
