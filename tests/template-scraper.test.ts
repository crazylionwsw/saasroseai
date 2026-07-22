import { describe, it, expect } from 'vitest'

describe('Template Scraper - Text Analysis', () => {
  it('should strip HTML tags', async () => {
    const { stripHtml } = await import('../central/api/src/template-scraper')
    const html = '<h1>标题</h1><p>正文内容<script>alert(1)</script></p>'
    const text = stripHtml(html)
    expect(text).not.toContain('<')
    expect(text).toContain('标题')
    expect(text).toContain('正文内容')
    expect(text).not.toContain('alert')
  })

  it('should remove style tags', async () => {
    const { stripHtml } = await import('../central/api/src/template-scraper')
    const html = '<style>.header{color:red}</style><p>内容</p>'
    const text = stripHtml(html)
    expect(text).not.toContain('header')
    expect(text).toContain('内容')
  })

  it('should handle empty string', async () => {
    const { stripHtml } = await import('../central/api/src/template-scraper')
    expect(stripHtml('')).toBe('')
    expect(stripHtml('<tag></tag>')).toBe('')
  })

  it('should extract phone numbers from text', async () => {
    const html = '<p>Call us: (604) 555-0123 or 1-800-555-0199</p>'
    const text = (await import('../central/api/src/template-scraper')).stripHtml(html)
    expect(text).toMatch(/604/)
    expect(text).toMatch(/555/)
  })

  it('should extract email from text', async () => {
    const html = '<p>Email: info@restaurant.ca</p>'
    const text = (await import('../central/api/src/template-scraper')).stripHtml(html)
    expect(text).toContain('info@restaurant.ca')
  })

  it('should handle HTML entities', async () => {
    const { stripHtml } = await import('../central/api/src/template-scraper')
    const html = '<p>Price: $12.99 &amp; tax</p>'
    const text = stripHtml(html)
    expect(text).not.toContain('&amp;')
  })
})
