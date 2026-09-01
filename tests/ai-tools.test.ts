import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const MENU = [
  {
    name: '主食',
    items: [
      { id: 'fr', name: '鸡肉炒饭', price: 12.99, isAvailable: true },
      { id: 'sr', name: '春卷', price: 3.5, isAvailable: true },
    ],
  },
]

function createToolsEnv() {
  const orders: any[] = []
  const carts = new Map<string, boolean>()
  const cartItems: any[] = []
  const payments: any[] = []
  let idSeq = 1

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('menu_categories')) return { menu_categories: JSON.stringify(MENU) }
          if (sql.includes('tax_rate')) return { tax_rate: 500 }
          if (sql.includes('enable_payment')) return { enable_payment: 1, enable_ordering: 1 }
          if (sql.includes('FROM carts WHERE')) return { id: args[0], status: 'open' }
          if (sql.includes('FROM orders WHERE id = ? AND merchant_id = ?')) {
            return orders.find((o) => o.id === args[0] && o.merchant_id === args[1]) || null
          }
          if (sql.includes('idempotency_key')) return null
          if (sql.includes('FROM payments WHERE order_id = ?')) return null
          if (sql.includes('FROM cart_items WHERE cart_id = ? AND merchant_id = ? AND item_id = ?')) return null
          return null
        },
        run: async () => {
          if (sql.includes('INSERT INTO carts')) carts.set(args[0], true)
          if (sql.includes('INSERT INTO cart_items')) cartItems.push({ id: `cl_${idSeq++}`, cart_id: args[1], item_id: args[3], qty: args[4], modifiers: args[5] })
          if (sql.includes('UPDATE cart_items')) return { meta: { changes: 1 } }
          if (sql.includes('INSERT INTO orders')) {
            orders.push({
              id: args[0], merchant_id: args[1], status: args[18], payment_status: args[19],
              subtotal_cents: args[13], tax_cents: args[14], tip_cents: args[15], total_cents: args[16],
            })
          }
          if (sql.includes("SET status = 'pending_payment'")) {
            const row = orders.find((o) => o.id === args[2] && o.merchant_id === args[3])
            if (row) { row.status = 'pending_payment'; row.payment_status = 'pending' }
            return { meta: { changes: 1 } }
          }
          if (sql.includes('INSERT INTO payments')) payments.push({ id: args[0], order_id: args[2] })
          if (sql.includes('analytics_events')) return { success: true }
          return { success: true, meta: { changes: 1 } }
        },
        all: async () => {
          if (sql.includes('FROM cart_items WHERE cart_id = ?')) {
            return { results: cartItems.filter((i) => i.cart_id === args[0]) }
          }
          return { results: [] }
        },
      }),
    }),
  }

  return {
    MERCHANT_DB: db,
    MERCHANT_ID: 'm-1',
    MERCHANT_TOKEN: 'test-token',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    _orders: orders,
  } as any
}

describe('AI Tools (TASK-044/045/046/047/048)', () => {
  it('search_menu returns matching items with server prices', async () => {
    const { executeTool } = await import('../merchant-template/worker/src/ai-tools')
    const env = createToolsEnv()
    const res = await executeTool('search_menu', { query: '炒饭' }, env)
    expect(res.ok).toBe(true)
    expect(res.data.length).toBe(1)
    expect(res.data[0].name).toBe('鸡肉炒饭')
    expect(res.data[0].priceCents).toBe(1299)
  })

  it('get_menu_item by id', async () => {
    const { executeTool } = await import('../merchant-template/worker/src/ai-tools')
    const env = createToolsEnv()
    const res = await executeTool('get_menu_item', { itemId: 'sr' }, env)
    expect(res.ok).toBe(true)
    expect(res.data.name).toBe('春卷')
  })

  it('rejects unknown tool and missing required args', async () => {
    const { executeTool } = await import('../merchant-template/worker/src/ai-tools')
    const env = createToolsEnv()
    expect((await executeTool('drop_table', {}, env)).ok).toBe(false)
    expect((await executeTool('search_menu', {}, env)).ok).toBe(false)
  })
})

describe('AI Ordering E2E (TASK-049, Gate #2)', () => {
  it('runs cart -> order -> payment flow reusing domain services', async () => {
    const { executeTool } = await import('../merchant-template/worker/src/ai-tools')
    const env = createToolsEnv()

    // create_cart
    const cart = await executeTool('create_cart', {}, env)
    expect(cart.ok).toBe(true)
    const cartId = cart.data.cartId

    // add_item x2 (两份鸡肉炒饭 + 一个春卷)
    expect((await executeTool('add_item', { cartId, itemId: 'fr', qty: 2 }, env)).ok).toBe(true)
    expect((await executeTool('add_item', { cartId, itemId: 'sr', qty: 1 }, env)).ok).toBe(true)

    // calculate_cart: 12.99*2 + 3.50 = 29.48; GST 5% = 1.474 -> 1.47; total 30.95
    const calc = await executeTool('calculate_cart', { cartId }, env)
    expect(calc.ok).toBe(true)
    expect(calc.data.subtotalCents).toBe(2948)
    expect(calc.data.totalCents).toBe(3095)

    // create_order
    const order = await executeTool('create_order', { cartId, orderType: 'pickup', customerName: '王小明' }, env)
    expect(order.ok).toBe(true)
    expect(order.data.totalCents).toBe(3095)
    expect(order.data.requiresPayment).toBe(true)

    // create_payment with mocked Stripe Checkout session
    const fakeSession = { id: 'cs_test', url: 'https://checkout.stripe.com/c/pay/cs_test' }
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify(fakeSession), { status: 200 })) as any
    try {
      const payment = await executeTool('create_payment', { orderId: order.data.orderId }, env)
      expect(payment.ok).toBe(true)
      expect(payment.data.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test')
      expect(payment.data.amountCents).toBe(3095)
    } finally {
      globalThis.fetch = originalFetch
    }

    // get_order_status
    const status = await executeTool('get_order_status', { orderId: order.data.orderId }, env)
    expect(status.ok).toBe(true)
    expect(status.data.status).toBe('pending_payment')
  })
})
