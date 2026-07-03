import type { Env } from './types'

interface ScrapeJob {
  id: string
  sourceUrl: string
  status: 'pending' | 'scraping' | 'analyzing' | 'generating' | 'completed' | 'failed'
  progress: string
  templateId?: string
  error?: string
  createdAt: string
  completedAt?: string
}

const SCRAPE_JOBS = new Map<string, ScrapeJob>()

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(error: string, code: number): Response {
  return new Response(JSON.stringify({ error, code }), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })
}

export function generateId(): string {
  return 'sc-' + crypto.randomUUID().slice(0, 12)
}

// Regex patterns for content detection
const PHONE_PATTERNS = [
  /1[3-9]\d{9}/g,
  /0\d{2,3}[-\s]?\d{7,8}/g,
  /\+86[-\s]?1[3-9]\d{9}/g,
] as const

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

// Assumed replaceable content types
interface DetectedContent {
  type: 'restaurant_name' | 'phone' | 'address' | 'business_hours' | 'email' | 'social' | 'price' | 'menu_item' | 'slogan' | 'description'
  original: string
  replacement: string
  confidence: number
  location: string
}

export async function handleScrapeWebsite(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { url: string }
    const { url } = body

    if (!url || !url.startsWith('http')) {
      return errorResponse('请提供有效的 URL', 400)
    }

    const jobId = generateId()
    const job: ScrapeJob = {
      id: jobId,
      sourceUrl: url,
      status: 'pending',
      progress: '等待处理',
      createdAt: new Date().toISOString(),
    }
    SCRAPE_JOBS.set(jobId, job)

    // Start async processing (not awaited)
    processScrapeJob(job, env).catch(err => {
      job.status = 'failed'
      job.error = err.message
      job.completedAt = new Date().toISOString()
    })

    return jsonResponse({ jobId, status: 'pending' })
  } catch {
    return errorResponse('请求格式错误', 400)
  }
}

export async function handleGetScrapeJob(request: Request, env: Env, jobId: string): Promise<Response> {
  const job = SCRAPE_JOBS.get(jobId)
  if (!job) return errorResponse('任务不存在', 404)
  return jsonResponse({ job })
}

export async function handleListScrapeJobs(request: Request, env: Env): Promise<Response> {
  const jobs = Array.from(SCRAPE_JOBS.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  return jsonResponse({ jobs })
}

async function processScrapeJob(job: ScrapeJob, env: Env): Promise<void> {
  const r2 = (env as any).TEMPLATES_R2 as R2Bucket
  const ai = (env as any).AI as Ai

  try {
    // Step 1: Fetch the website
    job.status = 'scraping'
    job.progress = `正在抓取: ${job.sourceUrl}`
    SCRAPE_JOBS.set(job.id, { ...job })

    const resp = await fetch(job.sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RoseSaaS-Scraper/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    if (!resp.ok) {
      throw new Error(`抓取失败: HTTP ${resp.status}`)
    }

    const html = await resp.text()
    const baseUrl = new URL(job.sourceUrl)

    // Discover linked pages
    job.progress = '发现页面结构'
    SCRAPE_JOBS.set(job.id, { ...job })
    const { pages, cssTexts, jsTexts } = await discoverPages(html, baseUrl)

    // Step 2: Analyze with LLM
    job.status = 'analyzing'
    job.progress = 'AI 正在分析页面内容...'
    SCRAPE_JOBS.set(job.id, { ...job })

    const analysis = await analyzeWithLLM(html, pages, cssTexts, ai)

    // Step 3: Generate template
    job.status = 'generating'
    job.progress = '正在生成模板文件...'
    SCRAPE_JOBS.set(job.id, { ...job })

    const templateId = await generateTemplate(job, html, pages, cssTexts, jsTexts, analysis, r2, baseUrl)

    // Step 4: Complete
    job.status = 'completed'
    job.progress = '模板生成完成'
    job.templateId = templateId
    job.completedAt = new Date().toISOString()
    SCRAPE_JOBS.set(job.id, { ...job })

  } catch (err) {
    job.status = 'failed'
    job.error = err instanceof Error ? err.message : String(err)
    job.completedAt = new Date().toISOString()
    SCRAPE_JOBS.set(job.id, { ...job })
  }
}

interface DiscoveredPages {
  pages: { path: string; title: string; html: string }[]
  cssTexts: string[]
  jsTexts: string[]
}

async function discoverPages(html: string, baseUrl: URL): Promise<DiscoveredPages> {
  const pages: { path: string; title: string; html: string }[] = []
  const cssTexts: string[] = []
  const jsTexts: string[] = []

  // Extract main page title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const mainTitle = titleMatch ? titleMatch[1].trim() : '首页'
  pages.push({ path: '/', title: mainTitle, html })

  // Find linked CSS files
  const cssLinks = html.matchAll(/<link[^>]*href=["']([^"']*\.css[^"']*)["'][^>]*>/gi)
  for (const match of cssLinks) {
    try {
      const cssUrl = new URL(match[1], baseUrl).href
      const cssResp = await fetch(cssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      if (cssResp.ok) {
        cssTexts.push(await cssResp.text())
      }
    } catch { /* skip failed CSS */ }
  }

  // Extract inline styles
  const styleBlocks = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)
  for (const match of styleBlocks) {
    cssTexts.push(match[1].trim())
  }

  // Discover linked pages from navigation
  const navLinks = new Set<string>()
  const linkMatches = html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>/gi)
  for (const match of linkMatches) {
    const href = match[1].trim()
    try {
      const url = new URL(href, baseUrl)
      if (url.hostname === baseUrl.hostname && !navLinks.has(url.pathname)) {
        navLinks.add(url.pathname)
      }
    } catch { /* skip invalid URLs */ }
  }

  // Fetch linked pages (limit to 5)
  let fetched = 0
  for (const path of navLinks) {
    if (fetched >= 5) break
    if (path === '/' || path === '') continue

    try {
      const pageUrl = new URL(path, baseUrl).href
      const pageResp = await fetch(pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      if (pageResp.ok) {
        const pageHtml = await pageResp.text()
        const pageTitle = pageHtml.match(/<title[^>]*>([^<]*)<\/title>/i)
        pages.push({
          path,
          title: pageTitle ? pageTitle[1].trim() : path,
          html: pageHtml,
        })
        fetched++
      }
    } catch { /* skip failed page */ }
  }

  return { pages, cssTexts, jsTexts }
}

interface LLMAnalysis {
  templateName: string
  description: string
  colorScheme: string[]
  detectedContent: DetectedContent[]
  menuPattern: string | null
  features: string[]
}

async function analyzeWithLLM(
  html: string,
  pages: { path: string; title: string; html: string }[],
  cssTexts: string[],
  ai: Ai
): Promise<LLMAnalysis> {
  const combinedHtml = pages.map(p => `=== ${p.title} (${p.path}) ===\n${stripHtml(p.html).slice(0, 2000)}`).join('\n\n')
  const combinedCss = cssTexts.join('\n').slice(0, 2000)

  const prompt = `你是一个网站模板分析器。分析以下餐厅网站内容并提取结构化信息。

页面内容：
${combinedHtml}

CSS 样式（部分）：
${combinedCss}

请分析并返回 JSON（只输出 JSON，不要其他文字）：
{
  "templateName": "建议的模板名称（简洁，如'传统中餐'）",
  "description": "模板简短描述（一句话）",
  "colorScheme": ["主色HEX", "辅色HEX", "背景色HEX"],
  "features": ["功能标签数组，如'在线菜单','在线下单','联系信息'"],
  "menuPattern": "菜单的数据模式描述，如'分类-菜品-价格'，无则null",
  "detectedContent": [
    {
      "type": "restaurant_name|phone|address|business_hours|email|social|price|menu_item|slogan|description",
      "original": "检测到的原始文本",
      "replacement": "建议的模板变量名（如 RESTAURANT_NAME）",
      "confidence": 0.0-1.0,
      "location": "出现在哪个页面或区域"
    }
  ]
}`

  try {
    const result = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    })

    const text = typeof result === 'string' ? result : (result as any).response
    const parsed = JSON.parse(text) as LLMAnalysis
    return {
      templateName: parsed.templateName || extractName(html),
      description: parsed.description || '',
      colorScheme: parsed.colorScheme || extractColors(cssTexts),
      detectedContent: parsed.detectedContent || [],
      menuPattern: parsed.menuPattern || null,
      features: parsed.features || ['在线菜单', '联系信息'],
    }
  } catch {
    // Fallback: regex detection without LLM
    return {
      templateName: extractName(html),
      description: '从网站自动采集',
      colorScheme: extractColors(cssTexts),
      detectedContent: detectByRegex(html),
      menuPattern: detectMenuPattern(html),
      features: ['在线菜单', '联系信息'],
    }
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractName(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (titleMatch) {
    return titleMatch[1].trim().replace(/[-|].*$/, '').trim()
  }
  const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i)
  if (h1Match) return h1Match[1].trim()
  return '新模板'
}

export function extractColors(cssTexts: string[]): string[] {
  const colors = new Set<string>()
  const colorRegex = /#[0-9a-fA-F]{3,8}|rgb\(\d+,\s*\d+,\s*\d+\)/g
  for (const css of cssTexts) {
    const matches = css.match(colorRegex)
    if (matches) {
      matches.forEach(c => {
        if (colors.size < 5) colors.add(c)
      })
    }
  }
  return Array.from(colors).slice(0, 3)
}

export function detectByRegex(html: string): DetectedContent[] {
  const detected: DetectedContent[] = []
  const text = stripHtml(html)

  // Phone numbers
  for (const pattern of PHONE_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) {
      detected.push({
        type: 'phone',
        original: matches[0],
        replacement: 'PHONE',
        confidence: 0.9,
        location: '页面正文',
      })
    }
  }

  // Email
  const emails = text.match(EMAIL_PATTERN)
  if (emails) {
    detected.push({
      type: 'email',
      original: emails[0],
      replacement: 'EMAIL',
      confidence: 0.9,
      location: '页面正文',
    })
  }

  // Business hours patterns
  const hourPattern = /\d{1,2}[:：]\d{2}\s*[-~至]\s*\d{1,2}[:：]\d{2}/g
  const hours = text.match(hourPattern)
  if (hours) {
    detected.push({
      type: 'business_hours',
      original: hours[0],
      replacement: 'BUSINESS_HOURS',
      confidence: 0.8,
      location: '页面正文',
    })
  }

  return detected
}

export function detectMenuPattern(html: string): string | null {
  // Look for price patterns near text
  const text = stripHtml(html)
  const priceItems = text.match(/[^\d\n]{2,10}?\s*[¥￥]?\d+\.?\d*/g)
  if (priceItems && priceItems.length > 3) {
    return 'price-text-pairs'
  }
  return null
}

async function generateTemplate(
  job: ScrapeJob,
  mainHtml: string,
  pages: { path: string; title: string; html: string }[],
  cssTexts: string[],
  jsTexts: string[],
  analysis: LLMAnalysis,
  r2: R2Bucket,
  baseUrl: URL
): Promise<string> {
  const templateId = analysis.templateName
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'scraped-' + job.id.slice(0, 6)

  const colorScheme = analysis.colorScheme.length >= 3
    ? analysis.colorScheme
    : ['#4F46E5', '#7C3AED', '#F5F5F5']

  // Build replacement map
  const replacements: Record<string, string> = {}
  for (const dc of analysis.detectedContent) {
    const varName = dc.replacement || dc.type.toUpperCase()
    replacements[dc.original] = `{{${varName}}}`
  }

  // Generate config.json
  const config = {
    name: analysis.templateName,
    description: analysis.description,
    sourceUrl: job.sourceUrl,
    features: analysis.features,
    colorScheme,
    author: 'Rose SaaS Scraper',
    scrapedAt: new Date().toISOString(),
  }

  await r2.put(`${templateId}/config.json`, JSON.stringify(config, null, 2))

  // Generate index.html - replace detected content with template vars
  let indexHtml = mainHtml
  for (const [original, replacement] of Object.entries(replacements)) {
    indexHtml = indexHtml.replaceAll(original, replacement)
  }

  // Add template header
  indexHtml = `<!-- Template generated from: ${job.sourceUrl} -->\n<!-- Auto-converted by Rose SaaS Template Scraper -->\n${indexHtml}`

  await r2.put(`${templateId}/index.html`, indexHtml)
  await r2.put(`${templateId}/preview.png`, new Uint8Array(0)) // placeholder

  // Save combined CSS
  if (cssTexts.length > 0) {
    const combinedCss = cssTexts.join('\n\n')
      .replaceAll(/url\(['"]?([^'")\s]+)['"]?\)/g, (match, urlPath) => {
        try {
          const absoluteUrl = new URL(urlPath, baseUrl).href
          return `url('${absoluteUrl}')`
        } catch {
          return match
        }
      })
    await r2.put(`${templateId}/style.css`, combinedCss)
  }

  // Save extracted JS
  if (jsTexts.length > 0) {
    const combinedJs = jsTexts.join('\n\n')
    await r2.put(`${templateId}/app.js`, combinedJs)
  }

  return templateId
}
