import { describe, it, expect, afterEach } from 'vitest'

function createCfEnv() {
  return {
    CENTRAL_DB: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes('cf_account_id, cf_api_token')) {
              return { cf_account_id: 'acct_1', cf_api_token: 'tok_1' }
            }
            return null
          },
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
      }),
    },
  } as any
}

describe('Custom Domain (TASK-062)', () => {
  afterEach(() => {
    const g = globalThis as any
    delete g.fetch
  })

  it('rejects an invalid domain', async () => {
    const { handleAddCustomDomain } = await import('../central/api/src/cf-deploy')
    const env = createCfEnv()
    const req = new Request('http://localhost/api/merchants/m-1/custom-domain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'not a domain' }),
    })
    const resp = await handleAddCustomDomain(req, env, 'm-1')
    expect(resp.status).toBe(400)
  })

  it('binds a custom domain to the merchant storefront project', async () => {
    const { handleAddCustomDomain } = await import('../central/api/src/cf-deploy')
    const env = createCfEnv()
    const calls: string[] = []
    globalThis.fetch = (async (input: any, init: any) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/projects/storefront-m-1')) {
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ success: true, result: { status: 'pending' } }), { status: 200 })
        }
        return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })
    }) as any

    const req = new Request('http://localhost/api/merchants/m-1/custom-domain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'order.example.com' }),
    })
    const resp = await handleAddCustomDomain(req, env, 'm-1')
    const data: any = await resp.json()
    expect(resp.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.domain).toBe('order.example.com')
    expect(calls.some((u) => u.includes('/domains'))).toBe(true)
  })
})
