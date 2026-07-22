import type { Env } from './types'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}
function errorResponse(error: string, code: number): Response {
  return new Response(JSON.stringify({ error, code }), { status: code, headers: { 'content-type': 'application/json' } })
}

export async function handleListMarketplaceTemplates(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const activeOnly = url.searchParams.get('active') !== 'false'
    let query = 'SELECT id, name, description, preview_url, features, created_at FROM templates'
    const params: string[] = []
    if (activeOnly) { query += ' WHERE is_active = 1' }
    query += ' ORDER BY created_at DESC'
    const { results } = await env.CENTRAL_DB.prepare(query).bind(...params).all()
    return jsonResponse({ templates: results || [] })
  } catch {
    return jsonResponse({ templates: [] })
  }
}

export async function handleSubmitTemplate(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const { name, description, templateData, developerName, developerEmail } = body
    if (!name || !templateData) return errorResponse('模板名称和数据必填', 400)
    const id = 'tpl-' + crypto.randomUUID().slice(0, 8)
    const features = JSON.stringify({ developerName: developerName || 'Anonymous', developerEmail: developerEmail || '', pages: Object.keys(templateData) })
    await env.CENTRAL_DB.prepare(
      'INSERT INTO templates (id, name, description, features, is_active, created_at) VALUES (?, ?, ?, ?, 0, datetime(\'now\'))'
    ).bind(id, name, description || null, features).run()
    for (const [filename, content] of Object.entries(templateData) as [string, string][]) {
      await env.TEMPLATES_R2.put(`templates/${id}/${filename}`, content)
    }
    return jsonResponse({ id, name, status: 'pending_review' }, 201)
  } catch (e) {
    return errorResponse('提交模板失败', 500)
  }
}

export async function handleApproveTemplate(request: Request, env: Env, templateId: string): Promise<Response> {
  try {
    const body = await request.json<any>()
    const isActive = body.approve !== false ? 1 : 0
    await env.CENTRAL_DB.prepare('UPDATE templates SET is_active = ? WHERE id = ?').bind(isActive, templateId).run()
    return jsonResponse({ id: templateId, isActive: !!isActive })
  } catch {
    return errorResponse('审批模板失败', 500)
  }
}

export async function handleDeleteTemplate(request: Request, env: Env, templateId: string): Promise<Response> {
  try {
    await env.CENTRAL_DB.prepare('DELETE FROM templates WHERE id = ?').bind(templateId).run()
    await env.TEMPLATES_R2.delete(`templates/${templateId}/index.html`).catch(() => {})
    await env.TEMPLATES_R2.delete(`templates/${templateId}/menu.html`).catch(() => {})
    await env.TEMPLATES_R2.delete(`templates/${templateId}/contact.html`).catch(() => {})
    await env.TEMPLATES_R2.delete(`templates/${templateId}/style.css`).catch(() => {})
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('删除模板失败', 500)
  }
}
