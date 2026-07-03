import { Env } from './types'
import { jsonResponse, errorResponse } from './utils'

export async function handleGenerateSite(request: Request, env: Env, data: any): Promise<Response> {
  try {
    const { merchantInfo, menuCategories } = data
    if (!merchantInfo) {
      return errorResponse('缺少商户信息', 400)
    }
    const templateId = merchantInfo.templateId || 'classic'
    const templateObj = await env.ASSETS.get(`templates/${templateId}/index.html`)
    if (!templateObj) {
      return errorResponse('模板不存在', 404)
    }
    const templateHtml = await templateObj.text()
    const injectedHtml = templateHtml
      .replace(/\{\{STORE_NAME\}\}/g, merchantInfo.name || '')
      .replace(/\{\{STORE_SLOGAN\}\}/g, merchantInfo.slogan || '')
      .replace(/\{\{STORE_DESCRIPTION\}\}/g, merchantInfo.description || '')
      .replace(/\{\{PRIMARY_COLOR\}\}/g, merchantInfo.primaryColor || '#8B0000')
      .replace(/\{\{MENU_DATA\}\}/g, JSON.stringify(menuCategories || []))
      .replace(/\{\{MERCHANT_ID\}\}/g, merchantInfo.id || '')
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
    const { templateId, merchantInfo, menuCategories } = body
    const templateObj = await env.ASSETS.get(`templates/${templateId || 'classic'}/index.html`)
    if (!templateObj) {
      return errorResponse('模板不存在', 404)
    }
    const templateHtml = await templateObj.text()
    const previewHtml = templateHtml
      .replace(/\{\{STORE_NAME\}\}/g, merchantInfo?.name || '')
      .replace(/\{\{STORE_SLOGAN\}\}/g, merchantInfo?.slogan || '')
      .replace(/\{\{STORE_DESCRIPTION\}\}/g, merchantInfo?.description || '')
      .replace(/\{\{PRIMARY_COLOR\}\}/g, merchantInfo?.primaryColor || '#8B0000')
      .replace(/\{\{MENU_DATA\}\}/g, JSON.stringify(menuCategories || []))
      .replace(/\{\{MERCHANT_ID\}\}/g, merchantInfo?.id || '')
    return new Response(previewHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch {
    return errorResponse('预览生成失败', 500, 500)
  }
}
