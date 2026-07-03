import { describe, it, expect, beforeAll } from 'vitest'

function createMockEnv() {
  const orders: any[] = []
  return {
    MERCHANT_DB: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes('SELECT * FROM orders WHERE id = ?')) {
              return orders.find(o => o.id === args[0]) || null
            }
            return null
          },
          run: async () => {
            if (sql.includes('INSERT INTO orders')) {
              const order = {
                id: args[0], merchant_id: args[1], customer_name: args[2],
                customer_phone: args[3], customer_address: args[4],
                items: args[5], subtotal: args[6], delivery_fee: args[7] || 0,
                discount: args[8] || 0, total: args[9], status: 'pending',
                payment_status: 'unpaid', note: args[10] || '',
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              }
              orders.push(order)
              return { success: true }
            }
            return { success: true }
          },
          all: async () => {
            let results = [...orders]
            if (sql.includes('WHERE status = ?') && args.length > 0) {
              results = results.filter(o => o.status === args[0])
            }
            // Handle pagination
            const offset = 0, limit = 20
            results = results.slice(offset, offset + limit)
            return { results }
          },
        }),
      }),
    },
    MERCHANT_ID: 'm-test-1',
    _orders: orders,
  } as any
}

describe('Order System', () => {
  const env = createMockEnv()

  it('should create an order', async () => {
    const { handleCreateOrder } = await import('../merchant-template/worker/src/order')

    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: JSON.stringify([{ itemId: 'item1', name: '宫保鸡丁', qty: 2, price: 38 }]),
        subtotal: 76,
        deliveryFee: 5,
        total: 81,
        customerName: '张三',
        customerPhone: '13800138000',
        customerAddress: '幸福路16号',
        note: '少辣',
      }),
    })
    const resp = await handleCreateOrder(req, env)
    const data = await resp.json()
    expect(resp.status === 200 || resp.status === 201).toBe(true)
    expect(data.id).toMatch(/^ORD-/)
    expect(data.total).toBe(81)
  })

  it('should list orders', async () => {
    const { handleListOrders } = await import('../merchant-template/worker/src/order')
    const req = new Request('http://localhost/api/orders')
    const resp = await handleListOrders(req, env)
    const data = await resp.json()
    expect(resp.status).toBe(200)
    expect(data.orders).toBeDefined()
    expect(Array.isArray(data.orders)).toBe(true)
  })

  it('should reject order without items', async () => {
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
