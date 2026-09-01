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
          if (sql.includes('FROM orders WHERE id = ? AND merchant_id = ?')) {
            return orders.find((o) => o.id === args[0] && o.merchant_id === args[1]) || null
          }
          return null
        },
        run: async () => {
          if (sql.includes('INSERT INTO orders')) {
            orders.push({
              id: args[0], merchant_id: args[1], order_number: args[2], order_type: args[3], table_id: args[4],
              customer_name: args[5], customer_phone: args[6], customer_address: args[7],
              items: args[8], note: args[9], subtotal: args[10], total: args[11],
              subtotal_cents: args[12], tax_cents: args[13], tip_cents: args[14], total_cents: args[15],
              currency: args[16], status: args[17], payment_status: args[18],
              created_at: args[19], updated_at: args[20],
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
