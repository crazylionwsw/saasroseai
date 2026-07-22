import type { Env } from './types'

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

function generateId(): string {
  return 'tpl-' + crypto.randomUUID().slice(0, 8)
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/&#[0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractText(html: string, pattern: RegExp): string[] {
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(html)) !== null) {
    results.push(m[1] || m[0])
  }
  return results
}

interface ExtractedContent {
  name: string
  phone: string
  email: string
  address: string
  businessHours: string
  description: string
  slogan: string
  socialLinks: Record<string, string>
  menuItems: { name: string; price: string; category: string }[]
  primaryColor: string
  pages: { path: string; title: string; html: string }[]
  cssTexts: string[]
  logoUrl: string
  coverUrl: string
}

const PHONE_PATTERNS = [
  /\+1[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/g,
  /\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/g,
  /\d{3}[\s-]?\d{3}[\s-]?\d{4}/g,
  /1[3-9]\d{9}/g,
  /0\d{2,3}[-\s]?\d{7,8}/g,
]

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

async function fetchPage(url: string): Promise<{ html: string; baseUrl: URL }> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-CA,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6',
    },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
  const html = await resp.text()
  return { html, baseUrl: new URL(url) }
}

async function discoverLinkedPages(html: string, baseUrl: URL): Promise<{ path: string; title: string; html: string }[]> {
  const pages: { path: string; title: string; html: string }[] = []
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  pages.push({ path: '/', title: titleMatch ? titleMatch[1].trim() : 'Home', html })

  const seen = new Set<string>(['/', ''])
  const links = extractText(html, /<a[^>]*href=["']([^"']+)["'][^>]*>/gi)

  for (const href of links) {
    if (seen.size >= 8) break
    try {
      const url = new URL(href, baseUrl)
      if (url.hostname !== baseUrl.hostname) continue
      const path = url.pathname.replace(/\/$/, '') || '/'
      if (seen.has(path)) continue
      seen.add(path)
      const pageResp = await fetch(url.href, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      })
      if (!pageResp.ok) continue
      const pageHtml = await pageResp.text()
      const pt = pageHtml.match(/<title[^>]*>([^<]*)<\/title>/i)
      pages.push({ path, title: pt ? pt[1].trim() : path, html: pageHtml })
    } catch {
      continue
    }
  }
  return pages
}

async function extractContent(mainHtml: string, pages: { path: string; title: string; html: string }[], baseUrl: URL): Promise<ExtractedContent> {
  const combinedText = pages.map(p => stripHtml(p.html)).join('\n')

  const nameMatch = mainHtml.match(/<title[^>]*>([^<]*)<\/title>/i)
  let name = nameMatch ? nameMatch[1].trim().replace(/[-|].*$/, '').trim() : ''
  if (!name) {
    const h1Match = mainHtml.match(/<h1[^>]*>([^<]*)<\/h1>/i)
    name = h1Match ? h1Match[1].trim() : baseUrl.hostname.replace(/^www\./, '').split('.')[0]
  }

  let phone = ''
  for (const pattern of PHONE_PATTERNS) {
    const m = combinedText.match(pattern)
    if (m) { phone = m[0].trim(); break }
  }

  const emailMatch = combinedText.match(EMAIL_PATTERN)
  const email = emailMatch ? emailMatch[0] : ''

  let address = ''

  const addrPatterns = [
    new RegExp('(\\d+\\s+[A-Za-z .]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Court|Ct|Place|Pl|Way|Lane|Ln|Highway|Hwy|Crescent|Cres|Gate|Gate)[\\s,]+[A-Za-z .]+[\\s,]+(?:BC|ON|AB|QC|SK|MB|NS|NB|PE|NL|YT|NT|NU))', 'i'),
    new RegExp('(\\d+\\s+[A-Za-z .]+(?:Street|St|Avenue|Ave|Road|Rd)[\\s,]+[A-Za-z .]+[\\s,]+[A-Z]{2}\\s+\\d{5})', 'i'),
    /(\d+\s+[A-Za-z\s]+(?:BC|ON|AB)\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d)/i,
    new RegExp('([A-Z]\\d[A-Z]\\s?\\d[A-Z]\\d)', 'g'),
  ]
  for (const pattern of addrPatterns) {
    const m = combinedText.match(pattern)
    if (m) {
      const raw = m[1] || m[0]
      if (raw.length >= 6) {
        address = raw.trim()
        break
      }
    }
  }

  if (!address) {
    const lines = combinedText.split(/\n|,\s*/).map((l: string) => l.trim()).filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      if (/\d+/.test(lines[i]) && /[A-Za-z]/.test(lines[i]) && lines[i].length > 10) {
        address = lines.slice(i, i + 3).filter((l: string) => l.length > 3).join(', ')
        break
      }
    }
  }

  const hoursPatterns = [
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^.]*?\d{1,2}[:.:]\d{2}\s*(?:am|pm|AM|PM)?\s*[-–to]+\s*\d{1,2}[:.:]\d{2}\s*(?:am|pm|AM|PM)?/gi,
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^.]*?(?:Closed|Open)/gi,
    /\d{1,2}[:.:]\d{2}\s*(?:am|pm|AM|PM)?\s*[-–to]+\s*\d{1,2}[:.:]\d{2}\s*(?:am|pm|AM|PM)?/g,
  ]
  let businessHours = ''
  for (const pattern of hoursPatterns) {
    const matches = combinedText.match(pattern)
    if (matches && matches.length > 0) {
      businessHours = matches.slice(0, 7).join(' | ')
      break
    }
  }

  let description = ''
  const metaDesc = mainHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
  if (metaDesc) description = metaDesc[1].trim()
  if (!description || description.length < 10) {
    const pTags = extractText(mainHtml, /<p[^>]*>([\s\S]{10,300}?)<\/p>/gi)
    if (pTags.length > 0) description = stripHtml(pTags[0]).slice(0, 300)
  }

  let slogan = ''
  const h2s = extractText(mainHtml, /<h2[^>]*>([^<]*)<\/h2>/gi)
  if (h2s.length > 0) slogan = h2s[0].trim()

  const socialLinks: Record<string, string> = {}
  const socialPatterns: Record<string, RegExp> = {
    facebook: /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9.]+/gi,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+/gi,
    twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[a-zA-Z0-9_]+/gi,
    yelp: /https?:\/\/(?:www\.)?yelp\.com\/biz\/[a-zA-Z0-9_-]+/gi,
  }
  for (const [name, pat] of Object.entries(socialPatterns)) {
    const m = combinedText.match(pat)
    if (m) socialLinks[name] = m[0]
  }

  const menuItems: { name: string; price: string; category: string }[] = []
  for (const page of pages) {
    const isMenu = /menu|our-food|lunch|dinner|dish|special|roll/i.test(page.path + page.title)
    if (!isMenu) continue
    const text = page.html
    const priceRegex = /\$(\d+[.]?\d{0,2})/g
    let pm: RegExpExecArray | null
    while ((pm = priceRegex.exec(text)) !== null) {
      const priceIdx = pm.index
      const before = text.slice(Math.max(0, priceIdx - 80), priceIdx)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const itemName = before.split(/[,.(]/)[0]?.trim() || ''
      if (itemName && itemName.length > 1 && itemName.length < 60) {
        const catMatch = before.match(/([A-Za-z\s]{3,40}?)\s*$/);
        (menuItems as any[]).push({ name: itemName, price: `$${pm[1]}`, category: catMatch ? catMatch[1].trim() : 'Main' })
      }
    }
  }

  const SKIP_COLORS = new Set(['#ffffff', '#000000', '#fff', '#000', '#c0c0c0', '#silver', '#333333', '#333', '#666666', '#666', '#999999', '#999', '#cccccc', '#ccc', '#f5f5f5', '#f0f0f0', '#e0e0e0', '#eeeeee', '#eee'])
  let primaryColor = '#8B0000'
  const colorRegex = /#[0-9a-fA-F]{6}/g
  const cssMatches: string[] = []
  const styles = extractText(mainHtml, /<style[^>]*>([\s\S]*?)<\/style>/gi)
  const linkColors = extractText(mainHtml, /color\s*:\s*(#[0-9a-fA-F]{6})/gi)
  if (linkColors.length > 0) cssMatches.push(...linkColors)
  for (const s of styles) {
    const c = s.match(colorRegex)
    if (c) cssMatches.push(...c)
  }
  for (const c of cssMatches) {
    if (!SKIP_COLORS.has(c.toLowerCase())) {
      primaryColor = c
      break
    }
  }

  const logoUrl = ''
  const coverUrl = ''

  return {
    name, phone, email, address, businessHours, description, slogan,
    socialLinks, menuItems, primaryColor,
    pages: pages.slice(1), cssTexts: [mainHtml], logoUrl, coverUrl,
  }
}

function generateTemplateHtml(content: ExtractedContent): { indexHtml: string; menuHtml: string; contactHtml: string; styleCss: string } {
  const primaryColor = content.primaryColor || '#8B0000'
  const secondaryColor = '#333'
  const bgColor = '#FFF8F0'

  const menuCategories = new Map<string, { name: string; price: string }[]>()
  for (const item of content.menuItems.slice(0, 30)) {
    const cat = item.category || 'Menu'
    if (!menuCategories.has(cat)) menuCategories.set(cat, [])
    menuCategories.get(cat)!.push({ name: item.name, price: item.price })
  }

  let menuSections = ''
  if (menuCategories.size > 0) {
    for (const [cat, items] of menuCategories) {
      menuSections += `<div class="menu-category"><h3>${escHtml(cat)}</h3>`
      items.forEach(item => {
        menuSections += `<div class="menu-item"><span class="item-name">${escHtml(item.name)}</span><span class="item-price">${escHtml(item.price)}</span></div>`
      })
      menuSections += '</div>'
    }
  } else {
    menuSections = '<p style="text-align:center;color:#999;padding:40px;">Menu information coming soon. Please contact us for details.</p>'
  }

  const featuredItems = content.menuItems.slice(0, 3).map(item =>
    `<div class="featured-item"><h4>${escHtml(item.name)}</h4><span class="price">${escHtml(item.price)}</span></div>`
  ).join('') || '<p style="text-align:center;color:#999;">Featured items coming soon</p>'

  const socialHtml = Object.entries(content.socialLinks).map(([platform, url]) =>
    `<a href="${escHtml(url)}" target="_blank" rel="noopener" class="social-link">${platform}</a>`
  ).join(' ')

  const styleCss = `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${bgColor};color:#333;line-height:1.6}
.container{max-width:1100px;margin:0 auto;padding:0 20px}
.header{background:${primaryColor};color:#fff;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.2)}
.header .container{display:flex;align-items:center;justify-content:space-between;padding:12px 20px}
.logo{display:flex;align-items:center;gap:10px}
.logo h1{font-size:20px;font-weight:700}
.nav{display:flex;gap:4px}
.nav a{color:rgba(255,255,255,0.85);text-decoration:none;padding:8px 14px;border-radius:6px;font-size:14px;transition:all 0.2s}
.nav a:hover,.nav a.active{background:rgba(255,255,255,0.15);color:#fff}
.hamburger{display:none;background:none;border:none;cursor:pointer;padding:8px}
.hamburger span{display:block;width:22px;height:2px;background:#fff;margin:4px 0;border-radius:2px}
.hero{background:linear-gradient(135deg,${primaryColor},#a00000);color:#fff;text-align:center;padding:80px 20px 60px}
.hero h2{font-size:36px;margin-bottom:12px}
.hero p{font-size:18px;opacity:0.9;margin-bottom:24px;max-width:600px;margin-left:auto;margin-right:auto}
.btn{display:inline-block;background:#fff;color:${primaryColor};padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;transition:all 0.2s}
.btn:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,0.2)}
.section{padding:60px 20px}
.section-title{font-size:28px;font-weight:700;text-align:center;margin-bottom:40px;color:#333}
.about-content{max-width:800px;margin:0 auto;font-size:16px;color:#555;line-height:1.8;text-align:center}
.featured-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;max-width:800px;margin:0 auto}
.featured-item{background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06);text-align:center}
.featured-item h4{font-size:16px;margin-bottom:8px;color:#333}
.featured-item .price{font-size:18px;font-weight:700;color:${primaryColor}}
.info-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;max-width:900px;margin:0 auto}
.info-card{background:#fff;border-radius:12px;padding:30px 20px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.06)}
.info-card .icon{font-size:32px;margin-bottom:8px}
.info-card h3{font-size:14px;color:#999;margin-bottom:4px;font-weight:600}
.info-card p{font-size:16px;color:#333}
.info-card a{color:${primaryColor};text-decoration:none}
.info-card a:hover{text-decoration:underline}
.footer{background:#222;color:rgba(255,255,255,0.6);text-align:center;padding:24px;font-size:13px}
.menu-page{padding:60px 20px}
.menu-category{margin-bottom:40px}
.menu-category h3{font-size:22px;font-weight:700;color:${primaryColor};margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid ${primaryColor}}
.menu-item{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #eee}
.menu-item:last-child{border-bottom:none}
.menu-item .item-name{font-size:16px;color:#333}
.menu-item .item-price{font-size:16px;font-weight:700;color:${primaryColor}}
.contact-page{padding:60px 20px}
.contact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px;max-width:900px;margin:0 auto}
.contact-info p{margin-bottom:12px;font-size:15px;color:#555}
.contact-info strong{color:#333}
.social-links{display:flex;gap:12px;margin-top:16px;flex-wrap:wrap}
.social-link{display:inline-block;padding:8px 16px;background:${primaryColor};color:#fff;border-radius:6px;text-decoration:none;font-size:13px;text-transform:capitalize}
.social-link:hover{opacity:0.9}
.chat-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:${primaryColor};color:#fff;border:none;font-size:24px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:200}
.chat-btn:hover{transform:scale(1.1)}
@media(max-width:768px){.nav{display:none}.nav.open{display:flex;flex-direction:column;position:absolute;top:100%;left:0;right:0;background:${primaryColor};padding:12px}.hamburger{display:block}.hero h2{font-size:28px}.hero{padding:50px 20px 40px}.section{padding:40px 20px}}`

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{RESTAURANT_NAME}} - Home</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="header">
<div class="container">
<div class="logo">
<h1>{{RESTAURANT_NAME}}</h1>
</div>
<button class="hamburger" onclick="document.querySelector('.nav').classList.toggle('open')"><span></span><span></span><span></span></button>
<nav class="nav">
<a href="index.html" class="active">Home</a>
<a href="menu.html">Menu</a>
<a href="contact.html">Contact</a>
</nav>
</div>
</header>

<section class="hero">
<h2>{{RESTAURANT_SLOGAN}}</h2>
<p>{{RESTAURANT_DESC_SHORT}}</p>
<a href="menu.html" class="btn">View Our Menu</a>
</section>

<section class="section">
<div class="container">
<h2 class="section-title">About Us</h2>
<div class="about-content"><p>{{RESTAURANT_DESC}}</p></div>
</div>
</section>

<section class="section" style="padding-top:0;">
<div class="container">
<h2 class="section-title">Featured Items</h2>
<div class="featured-grid">${featuredItems}</div>
</div>
</section>

<section class="section" style="padding-top:0;">
<div class="container">
<h2 class="section-title">Contact & Hours</h2>
<div class="info-grid">
<div class="info-card">
<div class="icon">📞</div>
<h3>Phone</h3>
<p><a href="tel:{{PHONE}}">{{PHONE}}</a></p>
</div>
<div class="info-card">
<div class="icon">📍</div>
<h3>Address</h3>
<p>{{ADDRESS}}</p>
</div>
<div class="info-card">
<div class="icon">🕐</div>
<h3>Hours</h3>
<p>{{BUSINESS_HOURS}}</p>
</div>
</div>
</div>
</section>

<footer class="footer">
<div class="container">
<p>&copy; {{YEAR}} {{RESTAURANT_NAME}} - Powered by Rose SaaS</p>
</div>
</footer>

<button class="chat-btn" onclick="alert('Please call {{PHONE}} for inquiries')">💬</button>
</body>
</html>`

  const menuHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{RESTAURANT_NAME}} - Menu</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="header">
<div class="container">
<div class="logo">
<h1>{{RESTAURANT_NAME}}</h1>
</div>
<button class="hamburger" onclick="document.querySelector('.nav').classList.toggle('open')"><span></span><span></span><span></span></button>
<nav class="nav">
<a href="index.html">Home</a>
<a href="menu.html" class="active">Menu</a>
<a href="contact.html">Contact</a>
</nav>
</div>
</header>

<main class="menu-page">
<div class="container">
<h2 class="section-title">Our Menu</h2>
${menuSections}
</div>
</main>

<footer class="footer">
<div class="container">
<p>&copy; {{YEAR}} {{RESTAURANT_NAME}} - Powered by Rose SaaS</p>
</div>
</footer>

<button class="chat-btn" onclick="alert('Please call {{PHONE}} for inquiries')">💬</button>
</body>
</html>`

  const contactHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{RESTAURANT_NAME}} - Contact</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="header">
<div class="container">
<div class="logo">
<h1>{{RESTAURANT_NAME}}</h1>
</div>
<button class="hamburger" onclick="document.querySelector('.nav').classList.toggle('open')"><span></span><span></span><span></span></button>
<nav class="nav">
<a href="index.html">Home</a>
<a href="menu.html">Menu</a>
<a href="contact.html" class="active">Contact</a>
</nav>
</div>
</header>

<main class="contact-page">
<div class="container">
<h2 class="section-title">Contact Us</h2>
<div class="contact-grid">
<div class="contact-info">
<p><strong>Phone:</strong> <a href="tel:{{PHONE}}" style="color:${primaryColor};text-decoration:none;">{{PHONE}}</a></p>
<p><strong>Email:</strong> <a href="mailto:{{EMAIL}}" style="color:${primaryColor};text-decoration:none;">{{EMAIL}}</a></p>
<p><strong>Address:</strong><br>{{ADDRESS}}</p>
<p><strong>Hours:</strong><br>{{BUSINESS_HOURS}}</p>
<div class="social-links">${socialHtml}</div>
</div>
<div class="contact-info">
<p><strong>Get in Touch</strong></p>
<p style="margin-top:12px;color:#555;">We'd love to hear from you! Whether you have a question about our menu, catering services, or want to make a reservation, feel free to reach out.</p>
</div>
</div>
</div>
</main>

<footer class="footer">
<div class="container">
<p>&copy; {{YEAR}} {{RESTAURANT_NAME}} - Powered by Rose SaaS</p>
</div>
</footer>

<button class="chat-btn" onclick="alert('Please call {{PHONE}} for inquiries')">💬</button>
</body>
</html>`

  return { indexHtml, menuHtml, contactHtml, styleCss }
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export async function handleScrapeWebsite(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { url: string }
    const { url } = body
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return errorResponse('请提供有效的 URL', 400)
    }

    const { html: mainHtml, baseUrl } = await fetchPage(url)
    const pages = await discoverLinkedPages(mainHtml, baseUrl)
    const content = await extractContent(mainHtml, pages, baseUrl)

    const templateId = generateId()
    const { indexHtml, menuHtml, contactHtml, styleCss } = generateTemplateHtml(content)

    const r2 = env.TEMPLATES_R2
    const scrapedPath = `scraped/${templateId}`
    const templatePath = `templates/${templateId}`

    const configData = {
      id: templateId,
      name: content.name,
      sourceUrl: url,
      scrapedAt: new Date().toISOString(),
      extracted: {
        name: content.name,
        phone: content.phone,
        email: content.email,
        address: content.address,
        businessHours: content.businessHours,
        slogan: content.slogan,
        description: content.description,
        menuItems: content.menuItems.length,
        color: content.primaryColor,
        socialLinks: Object.keys(content.socialLinks).length,
      },
    }

    const configJson = JSON.stringify(configData, null, 2)

    await r2.put(`${scrapedPath}/config.json`, configJson)
    await r2.put(`${scrapedPath}/index.html`, indexHtml)
    await r2.put(`${scrapedPath}/menu.html`, menuHtml)
    await r2.put(`${scrapedPath}/contact.html`, contactHtml)
    await r2.put(`${scrapedPath}/style.css`, styleCss)

    await r2.put(`${templatePath}/index.html`, indexHtml)
    await r2.put(`${templatePath}/menu.html`, menuHtml)
    await r2.put(`${templatePath}/contact.html`, contactHtml)
    await r2.put(`${templatePath}/style.css`, styleCss)

    try {
      await env.CENTRAL_DB.prepare(
        'INSERT OR REPLACE INTO templates (id, name, description, is_active, created_at, features) VALUES (?, ?, ?, 1, ?, ?)'
      ).bind(
        templateId,
        content.name,
        content.description.slice(0, 200),
        new Date().toISOString(),
        JSON.stringify({ sourceUrl: url, phone: content.phone, email: content.email, address: content.address })
      ).run()
    } catch {
      console.error('Failed to insert template into DB')
    }

    return jsonResponse({
      success: true,
      templateId,
      name: content.name,
      phone: content.phone,
      email: content.email,
      address: content.address,
      businessHours: content.businessHours,
      description: content.description,
      slogan: content.slogan,
      primaryColor: content.primaryColor,
      menuItems: content.menuItems,
      socialLinks: content.socialLinks,
      pagesFound: pages.length,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`采集失败: ${msg}`, 500)
  }
}

export async function handleGetScrapeJob(request: Request, env: Env, jobId: string): Promise<Response> {
  const r2 = env.TEMPLATES_R2
  const obj = await r2.get(`scraped/${jobId}/config.json`)
  if (!obj) return errorResponse('任务不存在', 404)
  const config = JSON.parse(await obj.text())
  return jsonResponse({
    job: {
      id: jobId,
      status: 'completed',
      templateId: config.id,
      sourceUrl: config.sourceUrl,
      progress: '已完成',
      createdAt: config.scrapedAt,
      completedAt: config.scrapedAt,
    },
  })
}

export async function handleGetTemplateFile(request: Request, env: Env, templateId: string): Promise<Response> {
  const url = new URL(request.url)
  const fileName = url.searchParams.get('file') || 'index.html'
  const r2 = env.TEMPLATES_R2

  const obj = await r2.get(`scraped/${templateId}/${fileName}`)
  if (!obj) return errorResponse('文件不存在', 404)

  const content = await obj.text()
  const contentType = fileName.endsWith('.css') ? 'text/css' :
    fileName.endsWith('.html') ? 'text/html' :
    fileName.endsWith('.json') ? 'application/json' : 'text/plain'

  return new Response(content, {
    headers: { 'content-type': contentType, 'access-control-allow-origin': '*' },
  })
}

export async function handleListScrapeJobs(request: Request, env: Env): Promise<Response> {
  const r2 = env.TEMPLATES_R2
  const objects = await r2.list({ prefix: 'scraped/', delimiter: '/' })
  const jobs: any[] = []
  if (objects.delimitedPrefixes) {
    for (const prefix of objects.delimitedPrefixes) {
      const configObj = await r2.get(`${prefix}config.json`)
      if (configObj) {
        const config = JSON.parse(await configObj.text())
        jobs.push({
          id: config.id,
          status: 'completed',
          sourceUrl: config.sourceUrl,
          progress: '已完成',
          templateId: config.id,
          createdAt: config.scrapedAt,
        })
      }
    }
  }
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return jsonResponse({ jobs })
}

export async function handleListTemplates(request: Request, env: Env): Promise<Response> {
  const BUILT_IN = [
    { id: 'classic', name: 'Classic', description: 'Classic restaurant template with traditional layout', is_active: 1, built_in: true },
    { id: 'modern', name: 'Modern', description: 'Modern restaurant template with contemporary design', is_active: 1, built_in: true },
  ]

  const templates: any[] = [...BUILT_IN]

  const builtInIds = new Set(BUILT_IN.map(t => t.id))

  try {
    const rows = await env.CENTRAL_DB.prepare(
      'SELECT id, name, description, is_active, created_at, features FROM templates ORDER BY created_at DESC'
    ).all()
    if (rows.results) {
      for (const row of rows.results) {
        if (builtInIds.has(row.id as string)) continue
        templates.push({
          id: row.id,
          name: row.name,
          description: row.description || '',
          is_active: row.is_active,
          created_at: row.created_at,
          features: row.features,
          built_in: false,
        })
      }
    }
  } catch {
    // Table may not exist
  }

  return jsonResponse({ templates })
}

export async function handleDeleteTemplate(request: Request, env: Env, templateId: string): Promise<Response> {
  try {
    const BUILT_IN = ['classic', 'modern']
    if (BUILT_IN.includes(templateId)) {
      return errorResponse('内置模板不可删除', 400)
    }

    const usage = await env.CENTRAL_DB.prepare(
      "SELECT COUNT(*) as count FROM merchants WHERE template_id = ? AND status != 'deleted'"
    ).bind(templateId).first<{ count: number }>()

    const usingCount = usage?.count || 0

    const body = await request.json<{ force?: boolean }>().catch(() => ({ force: false }))
    if (usingCount > 0 && !body.force) {
      return jsonResponse({
        confirm: true,
        usingCount,
        message: `有 ${usingCount} 个商户正在使用该模板，删除后已部署的商户不受影响，是否继续？`,
      })
    }

    await env.CENTRAL_DB.prepare('DELETE FROM templates WHERE id = ?').bind(templateId).run()

    try {
      const objects = await env.TEMPLATES_R2.list({ prefix: `templates/${templateId}/` })
      for (const obj of objects.objects) {
        await env.TEMPLATES_R2.delete(obj.key)
      }
    } catch {}

    return jsonResponse({ success: true, usingCount, deleted: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`删除模板失败: ${msg}`, 500)
  }
}

export async function handleSeedBuiltInTemplates(env: Env): Promise<void> {
  try {
    await env.CENTRAL_DB.prepare('DELETE FROM templates WHERE id IN (\'classic\', \'modern\')').run()
  } catch {
    // Table may not exist yet
  }
}
