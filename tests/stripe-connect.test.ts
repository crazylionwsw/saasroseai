import { describe, it, expect, afterEach } from 'vitest'

function createConnectEnv() {
  const accounts: any[] = []
  return {
    MERCHANT_ID: 'm-1',
    MERCHANT_TOKEN: 'test-token',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_CLIENT_ID: 'ca_test_client',
    MERCHANT_DB: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes('payment_accounts')) {
              return accounts.find((a) => a.merchant_id === args[0]) || null
            }
            return null
          },
          run: async () => {
            if (sql.includes('INSERT OR REPLACE INTO payment_accounts')) {
              accounts.push({ merchant_id: args[0], provider_account_id: args[1] })
            }
            return { meta: { changes: 1 } }
          },
        }),
      }),
    },
    _accounts: accounts,
  } as any
}

describe('Stripe Connect (TASK-034)', () => {
  afterEach(() => {
    const g = globalThis as any
    delete g.fetch
  })

  it('generates an authorize URL with signed state', async () => {
    const { handleStartStripeConnect } = await import('../merchant-template/worker/src/stripe-connect')
    const env = createConnectEnv()
    const resp = await handleStartStripeConnect(new Request('http://localhost/api/stripe/connect/start', { method: 'POST' }), env)
    const data: any = await resp.json()
    expect(resp.status).toBe(200)
    expect(data.authorizeUrl).toContain('connect.stripe.com/oauth/authorize')
    expect(data.authorizeUrl).toContain('client_id=ca_test_client')
    expect(data.authorizeUrl).toContain('state=')
  })

  it('stores the connected account on a valid callback', async () => {
    const { handleStartStripeConnect, handleStripeConnectCallback } = await import('../merchant-template/worker/src/stripe-connect')
    const env = createConnectEnv()

    const start = await handleStartStripeConnect(new Request('http://localhost/api/stripe/connect/start', { method: 'POST' }), env)
    const startData: any = await start.json()
    const state = new URL(startData.authorizeUrl).searchParams.get('state')

    globalThis.fetch = (async (input: any) => {
      const url = String(input)
      if (url.includes('/oauth/token')) {
        return new Response(JSON.stringify({ stripe_user_id: 'acct_connected', livemode: false }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    const cbUrl = `http://localhost/api/stripe/connect/callback?code=auth_code&state=${state}`
    const resp = await handleStripeConnectCallback(new Request(cbUrl), env)
    expect(resp.status).toBe(200)
    expect(env._accounts.length).toBe(1)
    expect(env._accounts[0].provider_account_id).toBe('acct_connected')

    const { getConnectedStripeAccount } = await import('../merchant-template/worker/src/stripe-connect')
    expect(await getConnectedStripeAccount(env)).toBe('acct_connected')
  })

  it('rejects a callback with a forged state', async () => {
    const { handleStripeConnectCallback } = await import('../merchant-template/worker/src/stripe-connect')
    const env = createConnectEnv()
    const cbUrl = 'http://localhost/api/stripe/connect/callback?code=x&state=forged.payload'
    const resp = await handleStripeConnectCallback(new Request(cbUrl), env)
    expect(resp.status).toBe(200)
    expect((await resp.text()).includes('失败')).toBe(true)
    expect(env._accounts.length).toBe(0)
  })
})
