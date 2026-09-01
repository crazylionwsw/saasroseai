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
    const allowedFields = ['name', 'slogan', 'description', 'phone', 'email', 'address', 'business_hours', 'logo_url', 'cover_url', 'primary_color', 'template_id', 'language', 'currency_symbol', 'social_media', 'tax_rate', 'enable_ordering', 'enable_payment', 'enable_chat', 'enable_phone']
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

export async function handleGetKnowledgeConfig(request: Request, env: Env): Promise<Response> {
  try {
    const row = await env.MERCHANT_DB.prepare(
      'SELECT drive_folder_id FROM merchant_info WHERE id = ?'
    ).bind(env.MERCHANT_ID).first<{ drive_folder_id: string | null }>()
    return jsonResponse({
      driveConfigured: !!(row?.drive_folder_id),
      driveFolderId: row?.drive_folder_id || null,
    })
  } catch {
    return errorResponse('获取知识库配置失败', 500, 500)
  }
}

export async function handleUpdateKnowledgeConfig(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ driveTokenEncrypted?: string; driveFolderId?: string }>()
    const updates: string[] = []
    const values: any[] = []
    if (body.driveTokenEncrypted !== undefined) {
      updates.push('drive_token_encrypted = ?')
      values.push(String(body.driveTokenEncrypted))
    }
    if (body.driveFolderId !== undefined) {
      updates.push('drive_folder_id = ?')
      values.push(String(body.driveFolderId))
    }
    if (updates.length === 0) return errorResponse('无更新字段', 400)
    values.push(env.MERCHANT_ID)
    await env.MERCHANT_DB.prepare(
      `UPDATE merchant_info SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run()
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('更新知识库配置失败', 500, 500)
  }
}

export async function handleAiAnalytics(request: Request, env: Env): Promise<Response> {
  try {
    const [sessions, msgs, tools] = await Promise.all([
      env.MERCHANT_DB.prepare(
        `SELECT status, COUNT(*) as count FROM chat_sessions WHERE merchant_id = ? GROUP BY status`
      ).bind(env.MERCHANT_ID).all<{ status: string; count: number }>(),
      env.MERCHANT_DB.prepare(
        `SELECT COUNT(*) as total FROM chat_messages WHERE merchant_id = ? AND role IN ('customer','ai')`
      ).bind(env.MERCHANT_ID).first<{ total: number }>(),
      env.MERCHANT_DB.prepare(
        `SELECT json_extract(event_data, '$.tool') as tool, COUNT(*) as count
         FROM analytics_events WHERE merchant_id = ? AND event_type = 'ai_tool'
         GROUP BY tool ORDER BY count DESC`
      ).bind(env.MERCHANT_ID).all<{ tool: string; count: number }>(),
    ])
    return jsonResponse({
      sessions: sessions.results || [],
      totalMessages: msgs?.total || 0,
      toolUsage: tools.results || [],
    })
  } catch {
    return errorResponse('获取 AI 分析失败', 500, 500)
  }
}
