import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// These tests validate the central API handler logic
// They use a simulated environment with in-memory D1

function createMockDb() {
  const stores: Record<string, any[]> = {
    merchants: [],
    merchant_configs: [],
    merchant_tokens: [],
    deployments: [],
    templates: [{ id: 'classic', name: '经典中餐', is_active: 1 }],
  }

  function matchQuery(sql: string, args: any[], store: any[]) {
    if (sql.includes('INSERT INTO merchants')) {
      const merchant = {
        id: args[0], name: args[1], email: args[2], phone: args[3],
        plan: args[4], template_id: args[5], subdomain: args[6],
        theme_color: args[7], created_at: args[8], status: 'active',
      }
      store.push(merchant)
      return { success: true }
    }
    if (sql.includes('INSERT INTO merchant_tokens')) {
      store.push({ merchant_id: args[0], token_hash: args[1], created_at: args[2] })
      return { success: true }
    }
    return { success: true }
  }

  function buildStmt(sql: string, args?: any[]) {
    const bindArgs = args || []
    const runMethods = {
      first: async () => {
        if (sql.includes('FROM merchants WHERE id = ?')) {
          return stores.merchants.find(m => m.id === bindArgs[0]) || null
        }
        if (sql.includes('FROM merchants')) {
          let results = [...stores.merchants]
          if (sql.includes('status = ?') && bindArgs.length > 0) {
            results = results.filter(m => m.status === bindArgs[0])
          }
          return results[0] || null
        }
        return null
      },
      run: async () => matchQuery(sql, bindArgs, stores.merchants),
      all: async () => {
        let results = [...stores.merchants]
        if (sql.includes('WHERE') && bindArgs.length > 0) {
          if (sql.includes('status = ?')) {
            results = results.filter(m => m.status === bindArgs[0])
          }
        }
        return { results }
      },
    }
    return {
      ...runMethods,
      bind: (...newArgs: any[]) => buildStmt(sql, newArgs),
    }
  }

  return {
    prepare: (sql: string) => buildStmt(sql),
    _stores: stores,
    _addMerchant: (m: any) => stores.merchants.push(m),
  }
}

function createMockEnv() {
  const db = createMockDb()
  return {
    CENTRAL_DB: db as any,
    JWT_SECRET: 'test-secret-key',
    ADMIN_API_TOKEN: 'test-admin-token',
    _db: db,
  }
}

describe('Central API - Merchant Management', () => {
  const env = createMockEnv() as any

  it('should list merchants', async () => {
    env._db._addMerchant({
      id: 'm-test1',
      name: '测试餐厅',
      status: 'active',
      plan: 'basic',
      subdomain: 'shop-m-test1',
      template_id: 'classic',
      theme_color: '#8B0000',
      created_at: '2025-01-01',
    })

    const { handleListMerchants } = await import('../central/api/src/merchants')
    const req = new Request('http://localhost/api/merchants', {
      headers: { Authorization: 'Bearer test-admin-token' },
    })
    const resp = await handleListMerchants(req, env)
    const data = await resp.json()
    expect(resp.status).toBe(200)
    expect(data.merchants).toBeDefined()
    expect(data.merchants.length).toBeGreaterThanOrEqual(1)
  })

  it('should create a merchant', async () => {
    const { handleCreateMerchant } = await import('../central/api/src/merchants')
    const req = new Request('http://localhost/api/merchants', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-admin-token',
      },
      body: JSON.stringify({
        name: '新餐厅',
        email: 'test@test.com',
        phone: '13800138000',
        plan: 'basic',
        templateId: 'classic',
      }),
    })
    const resp = await handleCreateMerchant(req, env)
    const data = await resp.json()
    expect(resp.status === 200 || resp.status === 201).toBe(true)
    expect(data.id).toMatch(/^m-/)
    expect(data.name).toBe('新餐厅')
    expect(data.subdomain).toMatch(/^shop-/)
  })

  it('should verify merchant status', async () => {
    env._db._addMerchant({
      id: 'm-verify1',
      name: '验证测试',
      status: 'active',
      plan: 'pro',
    })

    // Generate a valid token
    const { generateToken } = await import('../central/api/src/auth')
    const validToken = await generateToken('m-verify1', 'pro', env)

    const { handleVerifyMerchant } = await import('../central/api/src/merchants')
    const req = new Request('http://localhost/api/merchants/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
    })
    const resp = await handleVerifyMerchant(req, env)
    const data = await resp.json()
    expect(resp.status).toBe(200)
    expect(data.merchantId).toBe('m-verify1')
    expect(data.plan).toBe('pro')
  })
})
