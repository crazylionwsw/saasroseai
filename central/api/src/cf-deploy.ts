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

const CF_API_BASE = 'https://api.cloudflare.com/client/v4'

async function sha256Hex(content: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function cfApiFetch(path: string, apiToken: string, options: RequestInit = {}): Promise<any> {
  const url = path.startsWith('http') ? path : `${CF_API_BASE}${path}`
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = await resp.json() as any
  if (!resp.ok || !body.success) {
    const err = body.errors?.[0]?.message || body.messages?.[0]?.message || JSON.stringify(body)
    throw new Error(err)
  }
  return body.result
}

interface TemplateFiles {
  'index.html'?: string
  'menu.html'?: string
  'contact.html'?: string
  'style.css'?: string
}

async function getTemplateFiles(env: Env, templateId: string): Promise<TemplateFiles> {
  const files: TemplateFiles = {}
  for (const name of ['index.html', 'menu.html', 'contact.html', 'style.css'] as const) {
    const obj = await env.TEMPLATES_R2.get(`templates/${templateId}/${name}`)
    if (obj) {
      files[name] = await obj.text()
    }
  }
  return files
}

async function loadTranslationsFromR2(env: Env, lang: string): Promise<Record<string, string>> {
  const SUPPORTED_LANGS = ['zh', 'en', 'fr']
  const DEFAULT_LANG = 'zh'
  const fallback: Record<string, string> = {}
  try {
    const obj = await env.TEMPLATES_R2.get(`translations/${DEFAULT_LANG}.json`)
    if (obj) Object.assign(fallback, await obj.json())
  } catch {}
  if (lang === DEFAULT_LANG || !SUPPORTED_LANGS.includes(lang)) return fallback
  try {
    const obj = await env.TEMPLATES_R2.get(`translations/${lang}.json`)
    if (obj) {
      const t = await obj.json() as Record<string, string>
      return { ...fallback, ...t }
    }
  } catch {}
  return fallback
}

function fillTemplateVariables(files: TemplateFiles, vars: Record<string, string>, translations?: Record<string, string>): TemplateFiles {
  const filled: TemplateFiles = {}
  for (const [name, content] of Object.entries(files)) {
    if (!content) continue
    let html = content
    for (const [key, value] of Object.entries(vars)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    // Render {{T:key}} placeholders
    if (translations) {
      html = html.replace(/\{\{T:(\w+)\}\}/g, (_match: string, key: string) => {
        return translations[key] || key
      })
    }
    // Remove any remaining LANG_SELECTED_* placeholders
    html = html.replace(/\{\{LANG_SELECTED_(\w+)\}\}/g, '')
    filled[name as keyof TemplateFiles] = html
  }
  return filled
}

export async function handleDeployToMerchantCF(request: Request, env: Env, merchantId: string): Promise<Response> {
  try {
    if (!merchantId || typeof merchantId !== 'string') {
      return errorResponse('商户ID无效', 400)
    }

    const merchant = await env.CENTRAL_DB.prepare(
      `SELECT id, name, email, phone, template_id, cf_account_id, cf_api_token,
              slogan, description, address, business_hours, logo_url, cover_url, social_media, language
       FROM merchants WHERE id = ?`
    ).bind(merchantId).first() as Record<string, any> | null

    if (!merchant) return errorResponse('商户不存在', 404)

    const { cf_account_id: accountId, cf_api_token: apiToken, template_id: templateId } = merchant

    if (!accountId) return errorResponse('商户未配置 Cloudflare Account ID', 400)
    if (!apiToken) return errorResponse('商户未配置 Cloudflare API Token', 400)

    // Fetch template files from R2
    const templateFiles = await getTemplateFiles(env, templateId || 'classic')
    if (Object.keys(templateFiles).length === 0) {
      return errorResponse('模板文件不存在', 404)
    }

    // Fill template variables
    const now = new Date()
    let socialMedia: Record<string, string> = {}
    try {
      socialMedia = JSON.parse(merchant.social_media || '{}')
    } catch {}
    const merchantLang = (merchant.language && ['zh', 'en', 'fr'].includes(merchant.language)) ? merchant.language : 'zh'
    const currencySymbols: Record<string, string> = { zh: '¥', en: '$', fr: '$' }
    const currencySymbol = currencySymbols[merchantLang] || '$'
    const translations = await loadTranslationsFromR2(env, merchantLang)
    const translationsJson = JSON.stringify(translations).replace(/'/g, "\\'").replace(/</g, '\\u003c')
    const langSelectedVars: Record<string, string> = {}
    for (const lang of ['zh', 'en', 'fr']) {
      langSelectedVars[`LANG_SELECTED_${lang}`] = ''
    }
    langSelectedVars[`LANG_SELECTED_${merchantLang}`] = 'selected'

    const vars: Record<string, string> = {
      RESTAURANT_NAME: merchant.name || '',
      RESTAURANT_SLOGAN: merchant.slogan || '',
      RESTAURANT_DESC_SHORT: merchant.description ? merchant.description.slice(0, 100) : '',
      RESTAURANT_DESC: merchant.description || '',
      PHONE: merchant.phone || '',
      EMAIL: merchant.email || '',
      ADDRESS: merchant.address || '',
      BUSINESS_HOURS: merchant.business_hours || '',
      LOGO_URL: merchant.logo_url || '',
      COVER_URL: merchant.cover_url || '',
      YEAR: String(now.getFullYear()),
      WECHAT_URL: socialMedia.wechat || '#',
      DOUYIN_URL: socialMedia.douyin || '#',
      XIAOHONGSHU_URL: socialMedia.xiaohongshu || '#',
      LANG: merchantLang,
      CURRENCY_SYMBOL: currencySymbol,
      TRANSLATIONS_JSON: translationsJson,
      ...langSelectedVars,
    }
    const filledFiles = fillTemplateVariables(templateFiles, vars, translations)

    // Ensure Pages project exists
    const projectName = `storefront-${merchantId}`
    try {
      await cfApiFetch(`/accounts/${accountId}/pages/projects/${projectName}`, apiToken)
    } catch {
      await cfApiFetch(`/accounts/${accountId}/pages/projects`, apiToken, {
        method: 'POST',
        body: JSON.stringify({ name: projectName, production_branch: 'main' }),
      })
    }

    // Build manifest with SHA256 hashes
    const manifest: Record<string, string> = {}
    const fileContents: Record<string, string> = {}
    for (const [name, content] of Object.entries(filledFiles)) {
      if (!content) continue
      fileContents[name] = content
      manifest[name] = await sha256Hex(content)
    }

    // Step 1: Create deployment with manifest (get upload URLs)
    const deployment = await cfApiFetch(
      `/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      apiToken,
      {
        method: 'POST',
        body: JSON.stringify({ manifest }),
      },
    )

    // Step 2: Upload each file to its presigned URL
    if (deployment.upload_urls) {
      for (const [filename, uploadUrl] of Object.entries(deployment.upload_urls) as [string, string][]) {
        const content = fileContents[filename]
        if (!content) continue
        const uploadResp = await fetch(uploadUrl, {
          method: 'PUT',
          body: content,
        })
        if (!uploadResp.ok) {
          throw new Error(`上传 ${filename} 失败: ${uploadResp.status}`)
        }
      }
    }

    const pagesUrl = `https://${projectName}.pages.dev`

    // Record deployment in DB
    const deployId = 'd-' + crypto.randomUUID().slice(0, 8)
    const nowISO = now.toISOString()
    await env.CENTRAL_DB.prepare(
      'INSERT INTO deployments (id, merchant_id, version, status, worker_url, pages_url, cf_deployment_id, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      deployId, merchantId, nowISO.replace(/[:.]/g, '-'), 'success',
      '', pagesUrl, deployment?.id || '', nowISO, nowISO,
    ).run()

    return jsonResponse({
      success: true,
      pagesUrl,
      deploymentId: deployment?.id || deployId,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`部署失败: ${msg}`, 500)
  }
}
