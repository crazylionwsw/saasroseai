import { describe, it, expect } from 'vitest'

function createStorefrontEnv(html: string) {
  return {
    MERCHANT_ID: 'm-1',
    ASSETS: {
      get: async (key: string) => {
        if (key === 'translations/zh.json') return { json: async () => ({ cuisine_label: '中餐' }) }
        if (key.startsWith('templates/')) return { text: async () => html }
        return null
      },
    },
  } as any
}

describe('Storefront SEO (TASK-025)', () => {
  it('renders canonical URL, og meta and JSON-LD from merchant data', async () => {
    const { handleGenerateSite } = await import('../merchant-template/worker/src/storefront')
    const html = `<!DOCTYPE html><html><head>
      <title>{{RESTAURANT_NAME}}</title>
      <meta name="description" content="{{RESTAURANT_DESC_SHORT}}">
      <link rel="canonical" href="{{CANONICAL_URL}}">
      <meta property="og:image" content="{{COVER_URL}}">
      <script type="application/ld+json">{"name":"{{RESTAURANT_NAME}}"}</script>
    </head><body></body></html>`
    const env = createStorefrontEnv(html)
    const req = new Request('http://localhost/api/storefront/generate', { method: 'POST' })
    const resp = await handleGenerateSite(req, env, {
      merchantInfo: {
        id: 'm-1', name: '测试餐厅', description: '好吃的', coverUrl: 'https://img.example.com/cover.jpg',
        language: 'zh', templateId: 'classic',
      },
      menuCategories: [],
    })
    const data: any = await resp.json()
    const out = data.html
    expect(out).toContain('https://m-1.pages.dev')
    expect(out).toContain('https://img.example.com/cover.jpg')
    expect(out).toContain('"name":"测试餐厅"')
    expect(out).toContain('content="好吃的"')
  })
})

describe('Menu Metadata (TASK-010)', () => {
  it('returns vegetarian/vegan/spicy/allergens through the menu API', async () => {
    const { handleGetMenu } = await import('../merchant-template/worker/src/order')
    const env = {
      MERCHANT_ID: 'm-1',
      MERCHANT_DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              menu_categories: JSON.stringify([
                {
                  name: '主食',
                  items: [
                    { id: '1', name: '豆腐', price: 10, vegetarian: true, vegan: true, spicyLevel: 0, allergens: ['大豆'] },
                  ],
                },
              ]),
            }),
          }),
        }),
      },
    } as any
    const resp = await handleGetMenu(new Request('http://localhost/api/menu'), env)
    const data: any = await resp.json()
    expect(data.items[0].vegetarian).toBe(true)
    expect(data.items[0].vegan).toBe(true)
    expect(data.items[0].spicyLevel).toBe(0)
    expect(data.items[0].allergens).toEqual(['大豆'])
  })
})
