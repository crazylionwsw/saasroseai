import { Env } from './types'
import { jsonResponse, errorResponse, generateId } from './utils'

export async function handleListStores(request: Request, env: Env): Promise<Response> {
  try {
    const stores = await env.MERCHANT_DB.prepare(
      'SELECT * FROM stores WHERE merchant_id = ? ORDER BY created_at ASC'
    ).bind(env.MERCHANT_ID).all()
    return jsonResponse({ stores: stores.results || [] })
  } catch {
    return jsonResponse({ stores: [] })
  }
}

export async function handleCreateStore(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const { name, phone, address, businessHours, managerName, managerPhone, email } = body
    if (!name) return errorResponse('门店名称必填', 400)
    const id = generateId('store_')
    await env.MERCHANT_DB.prepare(
      'INSERT INTO stores (id, merchant_id, name, phone, address, business_hours, manager_name, manager_phone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, env.MERCHANT_ID, name, phone || null, address || null, businessHours || null, managerName || null, managerPhone || null, email || null).run()
    return jsonResponse({ id, name }, 201)
  } catch {
    return errorResponse('创建门店失败', 500, 500)
  }
}

export async function handleUpdateStore(request: Request, env: Env, storeId: string): Promise<Response> {
  try {
    const body = await request.json<any>()
    const allowedFields = ['name', 'phone', 'address', 'business_hours', 'manager_name', 'manager_phone', 'email', 'is_active']
    const updates: string[] = []
    const values: any[] = []
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`)
        values.push(body[field])
      }
    }
    if (updates.length === 0) return errorResponse('无更新字段', 400)
    values.push(storeId, env.MERCHANT_ID)
    await env.MERCHANT_DB.prepare(`UPDATE stores SET ${updates.join(', ')} WHERE id = ? AND merchant_id = ?`).bind(...values).run()
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('更新门店失败', 500, 500)
  }
}

export async function handleDeleteStore(request: Request, env: Env, storeId: string): Promise<Response> {
  try {
    await env.MERCHANT_DB.prepare('DELETE FROM stores WHERE id = ? AND merchant_id = ?').bind(storeId, env.MERCHANT_ID).run()
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('删除门店失败', 500, 500)
  }
}

export async function handleStoreAnalytics(request: Request, env: Env, storeId: string): Promise<Response> {
  try {
    const [store, orders] = await Promise.all([
      env.MERCHANT_DB.prepare('SELECT * FROM stores WHERE id = ? AND merchant_id = ?').bind(storeId, env.MERCHANT_ID).first(),
      env.MERCHANT_DB.prepare(
        "SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) as revenue FROM orders WHERE merchant_id = ?"
      ).bind(env.MERCHANT_ID).first(),
    ])
    if (!store) return errorResponse('门店不存在', 404)
    return jsonResponse({ store, analytics: orders || { total: 0, revenue: 0 } })
  } catch {
    return errorResponse('获取门店分析失败', 500, 500)
  }
}
