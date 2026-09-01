import { describe, it, expect } from 'vitest'

describe('Pricing Engine', () => {
  it('converts dollars to integer cents', async () => {
    const { priceToCents } = await import('../merchant-template/worker/src/pricing')
    expect(priceToCents(15.99)).toBe(1599)
    expect(priceToCents(0)).toBe(0)
    expect(priceToCents(-5)).toBe(0)
  })

  it('calculates lines with modifiers and enforces availability', async () => {
    const { calculateLines } = await import('../merchant-template/worker/src/pricing')
    const menu = [
      {
        id: '1', name: '鸡肉炒饭', price: 12.99, isAvailable: true,
        specifications: [{ name: '辣度', options: [{ label: '不辣', priceDelta: 0 }, { label: '加辣', priceDelta: 0.5 }] }],
      },
      { id: '2', name: '春卷', price: 3.5, isAvailable: true },
      { id: '3', name: '售罄菜', price: 10, isAvailable: false },
    ]
    const { lines, errors } = calculateLines(
      [{ id: '1', qty: 2, modifiers: ['加辣'] }, { id: '2', qty: 1 }, { id: '3', qty: 1 }, { id: '9', qty: 1 }],
      menu as any
    )
    expect(errors.join(';')).toContain('已下架')
    expect(errors.join(';')).toContain('菜品不存在')
    const friedRice = lines.find((l) => l.id === '1')
    expect(friedRice).toBeDefined()
    expect(friedRice!.priceCents).toBe(1349) // 12.99 + 0.50
    expect(friedRice!.lineCents).toBe(2698)  // *2
    expect(lines.find((l) => l.id === '2')!.lineCents).toBe(350)
  })

  it('computes a full quote with tax and tip', async () => {
    const { calculateQuote } = await import('../merchant-template/worker/src/pricing')
    const env = {
      MERCHANT_ID: 'm-1',
      MERCHANT_DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (sql.includes('menu_categories')) {
                return { menu_categories: JSON.stringify([{ name: 'Menu', items: [{ id: 'a', name: 'A', price: 10, isAvailable: true }] }]) }
              }
              if (sql.includes('tax_rate')) return { tax_rate: 500 }
              return null
            },
          }),
        }),
      },
    } as any

    const quote = await calculateQuote(env, [{ id: 'a', qty: 3 }], 10)
    expect(quote.subtotalCents).toBe(3000)
    expect(quote.taxCents).toBe(150)   // 5%
    expect(quote.tipCents).toBe(300)   // 10%
    expect(quote.totalCents).toBe(3450)
    expect(quote.currency).toBe('CAD')
  })
})
