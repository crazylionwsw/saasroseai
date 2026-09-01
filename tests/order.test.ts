import { describe, it, expect } from 'vitest'

const MENU = [
  {
    name: '热菜',
    items: [
      { id: 'item1', name: '宫保鸡丁', price: 38, isAvailable: true, category: '热菜' },
      { id: 'item2', name: '米饭', price: 3, isAvailable: true, category: '主食' },
    ],
  },
]

function createMockEnv() {
  const orders: any[] = []
  let paymentEventCount = 0
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('menu_categories')) return { menu_categories: JSON.stringify(MENU) }
          if (sql.includes('tax_rate')) return { tax_rate: 500 }
          if (sql.includes('enable_payment')) return { enable_payment: 0, enable_ordering: 1 }
          if (sql.includes('SELECT * FROM orders WHERE id = ?')) {
            return orders.find((o) => o.id === args[0]) || null
          }
          if (sql.includes('idempotency_key = ? AND merchant_id = ?')) {
            return orders.find((o) => o.idempotency_key === args[0] && o.merchant_id === args[1]) || null
          }
          if (sql.includes('FROM orders WHERE id = ? AND merchant_id = ?')) {
            return orders.find((o) => o.id === args[0] && o.merchant_id === args[1]) || null
          }
          return null
        },
        run: async () => {
          if (sql.includes('INSERT INTO orders')) {
            orders.push({
              id: args[0], merchant_id: args[1], order_number: args[2], order_type: args[3], table_id: args[4],
              idempotency_key: args[5],
              customer_name: args[6], customer_phone: args[7], customer_address: args[8],
              items: args[9], note: args[10], subtotal: args[11], total: args[12],
              subtotal_cents: args[13], tax_cents: args[14], tip_cents: args[15], total_cents: args[16],
              currency: args[17], status: args[18], payment_status: args[19],
              created_at: args[20], updated_at: args[21],
            })
            return { success: true, meta: { changes: 1 } }
          }
          if (sql.includes('INSERT INTO payment_events')) {
            return { success: true, meta: { changes: paymentEventCount++ === 0 ? 1 : 0 } }
          }
          return { success: true, meta: { changes: 1 } }
        },
        all: async () => {
          let results = [...orders]
          if (sql.includes('WHERE status = ?') && args.length > 0) {
            results = results.filter((o) => o.status === args[0])
          }
          return { results: results.slice(0, 20) }
        },
      }),
    }),
  }
  return {
    MERCHANT_DB: db,
    MERCHANT_ID: 'm-test-1',
    MERCHANT_TOKEN: 'test-merchant-token',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    _orders: orders,
  } as any
}

describe('Order System - Server-Side Pricing', () => {
  it('should compute prices on the server from the menu (client prices ignored)', async () => {
    const env = createMockEnv()
    const { handleCreateOrder } = await import('../merchant-template/worker/src/order')

    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderType: 'pickup',
        customerName: '张三',
        customerPhone: '13800138000',
        customerAddress: '幸福路16号',
        note: '少辣',
        // Client tries to smuggle prices/total - these must be ignored
        items: [{ id: 'item1', qty: 2 }, { id: 'item2', qty: 1 }],
        total: 0.01,
        subtotal: 0.01,
      }),
    })
    const resp = await handleCreateOrder(req, env)
    const data: any = await resp.json()
    expect(resp.status).toBe(201)
    expect(data.id).toMatch(/^ORD-/)
    // 宫保鸡丁 38.00*2 + 米饭 3.00 = 79.00; GST 5% = 3.95 => 82.95
    expect(data.subtotalCents).toBe(7900)
    expect(data.taxCents).toBe(395)
    expect(data.totalCents).toBe(8295)
    expect(data.status).toBe('paid')
  })

  it('should reject an unavailable item', async () => {
    const env = createMockEnv()
    const { handleCreateOrder } = await import('../merchant-template/worker/src/order')
    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderType: 'pickup',
        items: [{ id: 'not-exist', qty: 1 }],
      }),
    })
    const resp = await handleCreateOrder(req, env)
    const data: any = await resp.json()
    expect(resp.status).toBe(400)
    expect(data.error).toContain('菜品不存在')
  })

  it('should require table id for dine-in QR orders', async () => {
    const env = createMockEnv()
    const { handleCreateOrder } = await import('../merchant-template/worker/src/order')
    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderType: 'dine_in',
        items: [{ id: 'item1', qty: 1 }],
      }),
    })
    const resp = await handleCreateOrder(req, env)
    expect(resp.status).toBe(400)
  })

  it('should list orders', async () => {
    const env = createMockEnv()
    const { handleListOrders } = await import('../merchant-template/worker/src/order')
    const req = new Request('http://localhost/api/orders')
    const resp = await handleListOrders(req, env)
    const data: any = await resp.json()
    expect(resp.status).toBe(200)
    expect(Array.isArray(data.orders)).toBe(true)
  })

  it('should reject order without items', async () => {
    const env = createMockEnv()
    const { handleCreateOrder } = await import('../merchant-template/worker/src/order')
    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total: 0 }),
    })
    const resp = await handleCreateOrder(req, env)
    expect(resp.status).toBe(400)
  })
})

describe('Order Idempotency (TASK-020)', () => {
  it('returns the same order for a repeated Idempotency-Key', async () => {
    const env = createMockEnv()
    const { handleCreateOrder } = await import('../merchant-template/worker/src/order')
    const build = () =>
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'order-key-123' },
        body: JSON.stringify({
          orderType: 'pickup',
          customerName: '李四',
          items: [{ id: 'item1', qty: 1 }],
        }),
      })

    const first = await handleCreateOrder(build(), env)
    const firstData: any = await first.json()
    expect(first.status).toBe(201)

    const second = await handleCreateOrder(build(), env)
    const secondData: any = await second.json()
    expect(second.status).toBe(200)
    expect(secondData.id).toBe(firstData.id)
    expect(env._orders.length).toBe(1)
  })

  it('creates distinct orders for distinct keys', async () => {
    const env = createMockEnv()
    const { handleCreateOrder } = await import('../merchant-template/worker/src/order')
    const make = (key: string) =>
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ orderType: 'pickup', items: [{ id: 'item1', qty: 1 }] }),
      })

    await handleCreateOrder(make('k1'), env)
    await handleCreateOrder(make('k2'), env)
    expect(env._orders.length).toBe(2)
  })
})

describe('Order Status State Machine', () => {
  it('allows legal merchant transitions', async () => {
    const { canTransitionOrder } = await import('../merchant-template/worker/src/order-state')
    expect(canTransitionOrder('draft', 'pending_payment')).toBe(true)
    expect(canTransitionOrder('pending_payment', 'paid')).toBe(true)
    expect(canTransitionOrder('paid', 'confirmed')).toBe(true)
    expect(canTransitionOrder('confirmed', 'preparing')).toBe(true)
    expect(canTransitionOrder('preparing', 'ready')).toBe(true)
    expect(canTransitionOrder('ready', 'completed')).toBe(true)
  })

  it('blocks illegal transitions', async () => {
    const { canTransitionOrder } = await import('../merchant-template/worker/src/order-state')
    expect(canTransitionOrder('completed', 'pending_payment')).toBe(false)
    expect(canTransitionOrder('cancelled', 'preparing')).toBe(false)
    expect(canTransitionOrder('draft', 'ready')).toBe(false)
  })
})
