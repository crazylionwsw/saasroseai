import { Env } from './types'
import { jsonResponse, errorResponse, generateId } from './utils'

export async function handleGetProfile(request: Request, env: Env): Promise<Response> {
  try {
    const merchant = await env.MERCHANT_DB.prepare(
      'SELECT id, name, slogan, description, phone, email, address, business_hours, logo_url, cover_url, social_media, primary_color, template_id, language, currency_symbol FROM merchant_info WHERE id = ?'
    ).bind(env.MERCHANT_ID).first()
    if (!merchant) return errorResponse('商户不存在', 404)
    return jsonResponse(merchant)
  } catch {
    return errorResponse('获取商户信息失败', 500, 500)
  }
}

export async function handleUpdateProfile(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const allowedFields = ['name', 'slogan', 'description', 'phone', 'email', 'address', 'business_hours', 'logo_url', 'cover_url', 'primary_color', 'template_id', 'language']
    const updates: string[] = []
    const values: any[] = []
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`)
        values.push(body[field])
      }
    }
    if (updates.length === 0) return errorResponse('无更新字段', 400)
    values.push(env.MERCHANT_ID)
    await env.MERCHANT_DB.prepare(`UPDATE merchant_info SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('更新失败', 500, 500)
  }
}

export async function handleUpdateMenu(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const { categories } = body
    if (!categories) return errorResponse('缺少菜单分类数据', 400)
    await env.MERCHANT_DB.prepare(
      'UPDATE merchant_info SET menu_categories = ? WHERE id = ?'
    ).bind(JSON.stringify(categories), env.MERCHANT_ID).run()
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('更新菜单失败', 500, 500)
  }
}

export async function handleAnalyticsEvents(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const { eventType, eventData } = body
    if (!eventType) return errorResponse('缺少事件类型', 400)
    await env.MERCHANT_DB.prepare(
      'INSERT INTO analytics_events (merchant_id, event_type, event_data) VALUES (?, ?, ?)'
    ).bind(env.MERCHANT_ID, eventType, JSON.stringify(eventData || {})).run()
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('记录事件失败', 500, 500)
  }
}
