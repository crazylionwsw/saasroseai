import { Env } from './types'
import { jsonResponse, errorResponse } from './utils'

const SUPPORTED_LANGS = ['zh', 'en', 'fr']
const DEFAULT_LANG = 'zh'

async function loadTranslations(env: Env, lang: string): Promise<Record<string, string>> {
  const fallback: Record<string, string> = {}
  try {
    const fallbackObj = await env.ASSETS.get(`translations/${DEFAULT_LANG}.json`)
    if (fallbackObj) {
      Object.assign(fallback, await fallbackObj.json())
    }
  } catch {}
  if (lang === DEFAULT_LANG) return fallback
  try {
    const langObj = await env.ASSETS.get(`translations/${lang}.json`)
    if (langObj) {
      const translations = await langObj.json() as Record<string, string>
      return { ...fallback, ...translations }
    }
  } catch {}
  return fallback
}

function resolveLang(cookieLang: string | null, merchantLang: string | undefined): string {
  if (cookieLang && SUPPORTED_LANGS.includes(cookieLang)) return cookieLang
  if (merchantLang && SUPPORTED_LANGS.includes(merchantLang)) return merchantLang
  return DEFAULT_LANG
}

function getCurrencySymbol(lang: string): string {
  if (lang === 'zh') return '¥'
  return '$'
}

function renderTranslations(html: string, translations: Record<string, string>): string {
  return html.replace(/\{\{T:(\w+)\}\}/g, (_match, key: string) => {
    return translations[key] || key
  })
}

function renderLangSelected(html: string, lang: string): string {
  return html.replace(/\{\{LANG_SELECTED_(\w+)\}\}/g, (_match, code: string) => {
    return code === lang ? 'selected' : ''
  })
}

async function renderTemplate(html: string, env: Env, merchantInfo: any): Promise<string> {
  const detectedLang = resolveLang(null, merchantInfo.language)
  const translations = await loadTranslations(env, detectedLang)
  const currencySymbol = merchantInfo.currencySymbol || getCurrencySymbol(detectedLang)

  let result = html
  result = renderLangSelected(result, detectedLang)
  result = result
    .replace(/\{\{LANG\}\}/g, detectedLang)
    .replace(/\{\{CURRENCY_SYMBOL\}\}/g, currencySymbol)
    .replace(/\{\{TRANSLATIONS_JSON\}\}/g, JSON.stringify(translations).replace(/'/g, "\\'").replace(/</g, '\\u003c'))
    .replace(/\{\{RESTAURANT_NAME\}\}/g, merchantInfo.name || '')
    .replace(/\{\{RESTAURANT_SLOGAN\}\}/g, merchantInfo.slogan || '')
    .replace(/\{\{RESTAURANT_DESC\}\}/g, merchantInfo.description || '')
    .replace(/\{\{RESTAURANT_DESC_SHORT\}\}/g, merchantInfo.description ? merchantInfo.description.slice(0, 100) : '')
    .replace(/\{\{PHONE\}\}/g, merchantInfo.phone || '')
    .replace(/\{\{EMAIL\}\}/g, merchantInfo.email || '')
    .replace(/\{\{ADDRESS\}\}/g, merchantInfo.address || '')
    .replace(/\{\{BUSINESS_HOURS\}\}/g, merchantInfo.businessHours || '')
    .replace(/\{\{LOGO_URL\}\}/g, merchantInfo.logoUrl || '')
    .replace(/\{\{COVER_URL\}\}/g, merchantInfo.coverUrl || '')
    .replace(/\{\{YEAR\}\}/g, String(new Date().getFullYear()))
    .replace(/\{\{WECHAT_URL\}\}/g, merchantInfo.socialMedia?.wechat || '#')
    .replace(/\{\{DOUYIN_URL\}\}/g, merchantInfo.socialMedia?.douyin || '#')
    .replace(/\{\{XIAOHONGSHU_URL\}\}/g, merchantInfo.socialMedia?.xiaohongshu || '#')
  result = renderTranslations(result, translations)
  return result
}

async function loadTemplate(env: Env, templateId: string, page: string): Promise<string | null> {
  const templateObj = await env.ASSETS.get(`templates/${templateId}/${page}.html`)
  if (!templateObj) return null
  return await templateObj.text()
}

export async function handleGenerateSite(request: Request, env: Env, data: any): Promise<Response> {
  try {
    const { merchantInfo, menuCategories } = data
    if (!merchantInfo) {
      return errorResponse('缺少商户信息', 400)
    }
    const templateId = merchantInfo.templateId || 'classic'
    const templateHtml = await loadTemplate(env, templateId, 'index')
    if (!templateHtml) {
      return errorResponse('模板不存在', 404)
    }
    const injectedHtml = await renderTemplate(templateHtml, env, merchantInfo)
    const url = `${merchantInfo.id}.pages.dev`
    return jsonResponse({ url, html: injectedHtml })
  } catch {
    return errorResponse('生成失败', 500, 500)
  }
}

export async function handleGetTemplateList(env: Env): Promise<Response> {
  try {
    const objects = await env.ASSETS.list({ prefix: 'templates/' })
    const templates = objects.objects
      .filter(o => o.key.endsWith('/'))
      .map(o => ({
        id: o.key.replace('templates/', '').replace('/', ''),
        name: o.key.replace('templates/', '').replace('/', ''),
      }))
    return jsonResponse({ templates })
  } catch {
    return errorResponse('获取模板列表失败', 500, 500)
  }
}

export async function handleGeneratePreview(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const { templateId, merchantInfo, menuCategories, lang } = body
    const templateObj = await env.ASSETS.get(`templates/${templateId || 'classic'}/index.html`)
    if (!templateObj) {
      return errorResponse('模板不存在', 404)
    }
    const templateHtml = await templateObj.text()
    const previewInfo = { ...merchantInfo, language: lang || merchantInfo?.language }
    const previewHtml = await renderTemplate(templateHtml, env, previewInfo)
    return new Response(previewHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch {
    return errorResponse('预览生成失败', 500, 500)
  }
}

export { renderTemplate, loadTemplate, loadTranslations, resolveLang, getCurrencySymbol }
