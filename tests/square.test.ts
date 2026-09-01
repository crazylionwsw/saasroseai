import { describe, it, expect, afterEach } from 'vitest'

const SIGNATURE_KEY = 'sq_webhook_key_test'

async function hmacB64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

function createSquareEnv() {
  let eventInserts = 0
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes('payment_accounts')) return { metadata: JSON.stringify({ accessToken: 'sq_at_test' }) }
          if (sql.includes('FROM payments WHERE provider_payment_id')) return { order_id: 'ORD-1' }
          return null
        },
        run: async () => {
          if (sql.includes('INSERT INTO payment_events')) {
            eventInserts += 1
            return { success: true, meta: { changes: eventInserts === 1 ? 1 : 0 } }
          }
          return { success: true, meta: { changes: 1 } }
        },
        all: async () => ({ results: [] }),
      }),
    }),
  }
  return {
    MERCHANT_DB: db,
    MERCHANT_ID: 'm-1',
    MERCHANT_TOKEN: 't',
    SQUARE_ACCESS_TOKEN: 'sq_at_test',
    SQUARE_LOCATION_ID: 'L_TEST',
    SQUARE_WEBHOOK_SIGNATURE_KEY: SIGNATURE_KEY,
    _eventInserts: () => eventInserts,
  } as any
}

describe('Square Payment (TASK-038)', () => {
  afterEach(() => {
    const g = globalThis as any
    delete g.fetch
  })

  it('creates a checkout via Square payment links', async () => {
    const { SquarePaymentProvider } = await import('../merchant-template/worker/src/square-provider')
    globalThis.fetch = (async (input: any) => {
      if (String(input).includes('/v2/online-checkout/payment-links')) {
        return new Response(JSON.stringify({ payment_link: { id: 'PL_TEST', url: 'https://square.link/xyz' } }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any
    const env = createSquareEnv()
    const provider = new SquarePaymentProvider(env)
    const result = await provider.createCheckout({
      orderId: 'ORD-1', merchantId: 'm-1', amountCents: 2599, currency: 'CAD',
      successUrl: 'https://x/s', cancelUrl: 'https://x/c',
    })
    expect(result.checkoutUrl).toBe('https://square.link/xyz')
    expect(result.providerPaymentId).toBe('PL_TEST')
  })

  it('accepts a validly-signed Square webhook and is idempotent', async () => {
    const { handleSquareWebhook } = await import('../merchant-template/worker/src/payment')
    const env = createSquareEnv()
    const timestamp = new Date().toISOString()
    const raw = JSON.stringify({
      type: 'payment.updated',
      timestamp,
      data: { payment: { id: 'pay_1', status: 'COMPLETED', payment_link_id: 'PL_TEST' } },
    })
    const sig = await hmacB64(SIGNATURE_KEY, raw + timestamp)
    const build = () =>
      new Request('http://localhost/api/payments/webhook/square', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Square-Signature': sig },
        body: raw,
      })

    const first = await handleSquareWebhook(build(), env)
    expect(first.status).toBe(200)
    const dup = await handleSquareWebhook(build(), env)
    const dupData: any = await dup.json()
    expect(dupData.duplicate).toBe(true)
    expect(env._eventInserts()).toBe(2)
  })

  it('rejects a webhook with a bad signature', async () => {
    const { handleSquareWebhook } = await import('../merchant-template/worker/src/payment')
    const env = createSquareEnv()
    const raw = JSON.stringify({ type: 'payment.updated', timestamp: new Date().toISOString(), data: {} })
    const req = new Request('http://localhost/api/payments/webhook/square', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Square-Signature': 'AAAAAAAA' },
      body: raw,
    })
    const resp = await handleSquareWebhook(req, env)
    expect(resp.status).toBe(400)
    expect(env._eventInserts()).toBe(0)
  })
})
