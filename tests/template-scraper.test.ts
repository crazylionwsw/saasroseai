import { describe, it, expect } from 'vitest'

describe('Template Scraper - Text Analysis', () => {
  it('should detect phone numbers', async () => {
    const html = '<p>联系我们: 13800138000 或 010-88886666</p>'
    const { detectByRegex } = await import('../central/api/src/template-scraper')
    const results = detectByRegex(html)
    const phones = results.filter(r => r.type === 'phone')
    expect(phones.length).toBeGreaterThan(0)
    expect(phones[0].replacement).toBe('PHONE')
    expect(phones[0].confidence).toBeGreaterThan(0.5)
  })

  it('should detect email addresses', async () => {
    const html = '<p>邮箱: contact@restaurant.com</p>'
    const { detectByRegex } = await import('../central/api/src/template-scraper')
    const results = detectByRegex(html)
    const emails = results.filter(r => r.type === 'email')
    expect(emails.length).toBeGreaterThan(0)
  })

  it('should detect business hours', async () => {
    const html = '<p>营业时间: 10:00-22:00</p>'
    const { detectByRegex } = await import('../central/api/src/template-scraper')
    const results = detectByRegex(html)
    const hours = results.filter(r => r.type === 'business_hours')
    expect(hours.length).toBeGreaterThan(0)
  })

  it('should detect Chinese business hours format', async () => {
    const html = '<p>营业时间: 9:00至22:00</p>'
    const { detectByRegex } = await import('../central/api/src/template-scraper')
    const results = detectByRegex(html)
    const hours = results.filter(r => r.type === 'business_hours')
    expect(hours.length).toBeGreaterThan(0)
  })

  it('should extract restaurant name from title', async () => {
    const { extractName } = await import('../central/api/src/template-scraper')
    const html = '<html><head><title>幸福餐厅 - 官网</title></head></html>'
    const name = extractName(html)
    expect(name).toBe('幸福餐厅')
  })

  it('should extract name from h1 when no title', async () => {
    const { extractName } = await import('../central/api/src/template-scraper')
    const html = '<html><body><h1>老北京炸酱面馆</h1></body></html>'
    const name = extractName(html)
    expect(name).toBe('老北京炸酱面馆')
  })

  it('should extract colors from CSS', async () => {
    const { extractColors } = await import('../central/api/src/template-scraper')
    const cssTexts = [
      'body { background: #F5F5F5; }',
      '.header { background: #8B0000; color: #FFD700; }',
    ]
    const colors = extractColors(cssTexts)
    expect(colors.length).toBeGreaterThanOrEqual(2)
    expect(colors).toContain('#F5F5F5')
    expect(colors).toContain('#8B0000')
  })

  it('should detect menu price pattern', async () => {
    const { detectMenuPattern } = await import('../central/api/src/template-scraper')
    const html = '<div>宫保鸡丁38元、鱼香肉丝32元、麻婆豆腐18元、回锅肉42元</div>'
    const pattern = detectMenuPattern(html)
    expect(pattern).toBe('price-text-pairs')
  })

  it('should generate ID from template name', async () => {
    const { generateId: rawId } = await import('../central/api/src/template-scraper')
    // test the standalone generateId for scrape jobs
    const id = rawId()
    expect(id).toMatch(/^sc-[a-f0-9-]+$/)
  })

  it('should strip HTML tags', async () => {
    const { stripHtml } = await import('../central/api/src/template-scraper')
    const html = '<h1>标题</h1><p>正文内容<script>alert(1)</script></p>'
    const text = stripHtml(html)
    expect(text).not.toContain('<')
    expect(text).toContain('标题')
    expect(text).toContain('正文内容')
    expect(text).not.toContain('alert')
  })
})
