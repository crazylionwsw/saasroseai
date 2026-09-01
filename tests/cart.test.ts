import { describe, it, expect } from 'vitest'

const MENU = [
  {
    name: '主食',
    items: [
      {
        id: 'fried-rice', name: '鸡肉炒饭', price: 12.99, isAvailable: true,
        specifications: [{ name: '辣度', options: [{ label: '加辣', priceDelta: 0.5 }] }],
      },
      { id: 'spring-roll', name: '春卷', price: 3.5, isAvailable: true },
      { id: 'sold-out', name: '售罄菜', price: 10, isAvailable: false },
    ],
  },
]

function createCartEnv() {
  const carts = new Map<string, { id: string; merchant_id: string; status: string }>()
  const items: any[] = []
  return {
    MERCHANT_ID: 'm-1',
    MERCHANT_DB: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes('menu_categories')) return { menu_categories: JSON.stringify(MENU) }
            if (sql.includes('tax_rate')) return { tax_rate: 500 }
            if (sql.includes('FROM carts WHERE')) return carts.get(args[0]) || null
            if (sql.includes('FROM cart_items WHERE cart_id = ? AND merchant_id = ?')) {
              return items.find((i) => i.cart_id === args[0] && i.item_id === args[1] && i.modifiers === args[2]) || null
            }
            return null
          },
          run: async () => {
            if (sql.includes('INSERT INTO carts')) {
              carts.set(args[0], { id: args[0], merchant_id: args[1], status: 'open' })
            } else if (sql.includes('INSERT INTO cart_items')) {
              items.push({ id: args[0], cart_id: args[1], merchant_id: args[2], item_id: args[3], qty: args[4], modifiers: args[5] })
            } else if (sql.includes('UPDATE cart_items SET qty')) {
              const row = items.find((i) => i.id === args[1])
              if (row) row.qty = args[0]
            }
            return { success: true, meta: { changes: 1 } }
          },
          all: async () => {
            if (sql.includes('FROM cart_items WHERE cart_id = ?')) {
              return { results: items.filter((i) => i.cart_id === args[0]) }
            }
            return { results: [] }
          },
        }),
      }),
    },
    _items: items,
  } as any
}

describe('Cart Domain (TASK-011/015)', () => {
  it('creates a cart', async () => {
    const { createCart, getCart } = await import('../merchant-template/worker/src/cart')
    const env = createCartEnv()
    const cartId = await createCart(env)
    expect(cartId).toMatch(/^cart_/)
    const cart = await getCart(env, cartId)
    expect(cart).not.toBeNull()
    expect(cart!.lines).toEqual([])
  })

  it('adds items and computes lines from server menu', async () => {
    const { createCart, addItemToCart, getCart } = await import('../merchant-template/worker/src/cart')
    const env = createCartEnv()
    const cartId = await createCart(env)
    const line = await addItemToCart(env, cartId, { id: 'fried-rice', qty: 2, modifiers: ['加辣'] })
    expect(line.name).toBe('鸡肉炒饭')
    expect(line.unitCents).toBe(1349) // 12.99 + 0.50 modifier
    expect(line.lineCents).toBe(2698)

    const cart = await getCart(env, cartId)
    expect(cart!.lines.length).toBe(1)
    expect(cart!.lines[0].qty).toBe(2)
  })

  it('rejects unavailable items', async () => {
    const { createCart, addItemToCart } = await import('../merchant-template/worker/src/cart')
    const env = createCartEnv()
    const cartId = await createCart(env)
    await expect(addItemToCart(env, cartId, { id: 'sold-out', qty: 1 })).rejects.toThrow('已下架')
  })

  it('calculates a quote with tax', async () => {
    const { createCart, addItemToCart, calculateCartQuote } = await import('../merchant-template/worker/src/cart')
    const env = createCartEnv()
    const cartId = await createCart(env)
    await addItemToCart(env, cartId, { id: 'spring-roll', qty: 2 })
    const quote = await calculateCartQuote(env, cartId)
    expect(quote.subtotalCents).toBe(700)
    expect(quote.taxCents).toBe(35) // 5%
    expect(quote.totalCents).toBe(735)
  })
})
