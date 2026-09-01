import { describe, it, expect } from 'vitest'

describe('Tax Engine (TASK-013)', () => {
  it('uses sum of active tax rules (GST + PST)', async () => {
    const { calculateQuote } = await import('../merchant-template/worker/src/pricing')
    const env = {
      MERCHANT_ID: 'm-1',
      MERCHANT_DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (sql.includes('menu_categories')) {
                return { menu_categories: JSON.stringify([{ name: 'Menu', items: [{ id: 'a', name: 'A', price: 100, isAvailable: true }] }]) }
              }
              if (sql.includes('tax_rate')) return { tax_rate: 500 }
              return null
            },
            all: async () => {
              if (sql.includes('FROM tax_rules')) {
                return { results: [{ tax_code: 'GST', rate_bp: 500 }, { tax_code: 'PST', rate_bp: 700 }] }
              }
              return { results: [] }
            },
          }),
        }),
      },
    } as any

    const quote = await calculateQuote(env, [{ id: 'a', qty: 1 }])
    expect(quote.subtotalCents).toBe(10000)
    expect(quote.taxCents).toBe(1200) // 5% + 7% = 12%
    expect(quote.totalCents).toBe(11200)
  })

  it('falls back to merchant_info.tax_rate when no rules exist', async () => {
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
              if (sql.includes('tax_rate')) return { tax_rate: 1300 }
              return null
            },
            all: async () => ({ results: [] }),
          }),
        }),
      },
    } as any

    const quote = await calculateQuote(env, [{ id: 'a', qty: 1 }])
    expect(quote.taxCents).toBe(130) // 13% HST
    expect(quote.totalCents).toBe(1130)
  })
})

describe('Tax Rules API', () => {
  it('validates tax codes and rates', async () => {
    const { handleUpdateTaxRules } = await import('../merchant-template/worker/src/tax')
    const env = {
      MERCHANT_ID: 'm-1',
      MERCHANT_DB: {
        prepare: () => ({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) }),
        batch: async () => [],
      },
    } as any
    const bad = new Request('http://localhost/api/merchant/tax', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: [{ taxCode: 'XX', rateBp: 500 }] }),
    })
    const resp = await handleUpdateTaxRules(bad, env)
    expect(resp.status).toBe(400)
  })
})
