import { describe, it, expect } from 'vitest'

function createUsageEnv(plan: string, orders: number) {
  return {
    MERCHANT_ID: 'm-1',
    MERCHANT_DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('plan FROM merchant_info')) return { plan }
            if (sql.includes('COUNT(*) as c FROM orders')) return { c: orders }
            if (sql.includes('SUM(total_cents)')) return { t: 50000 }
            if (sql.includes('chat_sessions')) return { c: 4 }
            if (sql.includes("ai_tool")) return { c: 12 }
            if (sql.includes('call_records')) return { c: 2 }
            if (sql.includes('staff_users')) return { c: 1 }
            return null
          },
        }),
      }),
    },
  } as any
}

describe('Usage & Plan Limits (TASK-058/059)', () => {
  it('reports usage with plan limits', async () => {
    const { getUsage, getPlanLimits } = await import('../merchant-template/worker/src/usage')
    const env = createUsageEnv('pro', 123)
    const data = await getUsage(env)
    expect(data.plan).toBe('pro')
    expect(data.limits).toEqual(getPlanLimits('pro'))
    expect(data.usage.monthlyOrders).toBe(123)
    expect(data.usage.aiToolCalls).toBe(12)
  })

  it('blocks new orders when the monthly quota is reached', async () => {
    const { enforceOrderQuota, getPlanLimits } = await import('../merchant-template/worker/src/usage')
    const basic = getPlanLimits('basic')
    const env = createUsageEnv('basic', basic.monthlyOrders)
    const result = await enforceOrderQuota(env)
    expect(result.allowed).toBe(false)
    expect(result.message).toContain('上限')
  })

  it('allows orders under the quota', async () => {
    const { enforceOrderQuota } = await import('../merchant-template/worker/src/usage')
    const env = createUsageEnv('basic', 5)
    expect((await enforceOrderQuota(env)).allowed).toBe(true)
  })
})

describe('Delivery Integration (TASK-064)', () => {
  function createDeliveryEnv() {
    const rows: any[] = []
    return {
      MERCHANT_ID: 'm-1',
      MERCHANT_DB: {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            run: async () => {
              if (sql.includes('INSERT INTO delivery_orders')) {
                rows.push({ id: args[0], merchant_id: args[1], platform: args[3], delivery_status: 'pending' })
                return { meta: { changes: 1 } }
              }
              if (sql.includes('UPDATE delivery_orders')) {
                const row = rows.find((r) => r.id === args[2])
                if (row) row.delivery_status = args[0]
                return { meta: { changes: row ? 1 : 0 } }
              }
              return { meta: { changes: 0 } }
            },
          }),
        }),
      },
      _rows: rows,
    } as any
  }

  it('creates and updates a delivery order', async () => {
    const { handleCreateDelivery, handleUpdateDelivery } = await import('../merchant-template/worker/src/delivery')
    const env = createDeliveryEnv()
    const create = await handleCreateDelivery(new Request('http://localhost/api/deliveries', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'ubereats', customerName: 'A', totalCents: 2599 }),
    }), env)
    expect(create.status).toBe(201)
    const id = env._rows[0].id

    const upd = await handleUpdateDelivery(new Request('http://localhost/api/deliveries/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryStatus: 'delivering' }),
    }), env, id)
    expect(upd.status).toBe(200)
    expect(env._rows[0].delivery_status).toBe('delivering')
  })

  it('rejects an invalid delivery status', async () => {
    const { handleUpdateDelivery } = await import('../merchant-template/worker/src/delivery')
    const env = createDeliveryEnv()
    const resp = await handleUpdateDelivery(new Request('http://localhost/api/deliveries/x', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryStatus: 'bogus' }),
    }), env, 'x')
    expect(resp.status).toBe(400)
  })
})
