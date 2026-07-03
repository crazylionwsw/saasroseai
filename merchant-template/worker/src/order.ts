import { Env, Order, D1MerchantInfo } from './types'
import { jsonResponse, errorResponse, generateOrderId, paginate } from './utils'

export async function handleCreateOrder(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const { items, subtotal, total, customerName, customerPhone, customerAddress, note } = body
    if (!items || subtotal === undefined || total === undefined) {
      return errorResponse('缺少必填字段 (items, subtotal, total)', 400)
    }
    const orderId = generateOrderId()
    const now = new Date().toISOString()
    await env.MERCHANT_DB.prepare(
      `INSERT INTO orders (id, merchant_id, customer_name, customer_phone, customer_address, items, subtotal, total, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(orderId, env.MERCHANT_ID, customerName || null, customerPhone || null, customerAddress || null, JSON.stringify(items), subtotal, total, note || null, now, now).run()
    return jsonResponse({ id: orderId, merchantId: env.MERCHANT_ID, items, subtotal, total, status: 'pending', paymentStatus: 'unpaid', createdAt: now, updatedAt: now }, 201)
  } catch {
    return errorResponse('创建订单失败', 500, 500)
  }
}

export async function handleGetOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  try {
    const result = await env.MERCHANT_DB.prepare(
      'SELECT * FROM orders WHERE id = ? AND merchant_id = ?'
    ).bind(orderId, env.MERCHANT_ID).first<Order | null>()
    if (!result) {
      return errorResponse('订单不存在', 404)
    }
    return jsonResponse(result)
  } catch {
    return errorResponse('查询订单失败', 500, 500)
  }
}

export async function handleListOrders(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const { offset, limit } = paginate(request)
    let query = 'SELECT * FROM orders WHERE merchant_id = ?'
    let countQuery = 'SELECT COUNT(*) as total FROM orders WHERE merchant_id = ?'
    const params: any[] = [env.MERCHANT_ID]
    if (status) {
      query += ' AND status = ?'
      countQuery += ' AND status = ?'
      params.push(status)
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    const orders = await env.MERCHANT_DB.prepare(query).bind(...params, limit, offset).all<Order>()
    const countResult = await env.MERCHANT_DB.prepare(countQuery).bind(...(status ? [env.MERCHANT_ID, status] : [env.MERCHANT_ID])).first<{ total: number }>()
    return jsonResponse({ orders: orders.results, total: countResult?.total || 0, offset, limit })
  } catch {
    return errorResponse('查询订单列表失败', 500, 500)
  }
}

export async function handleUpdateOrderStatus(request: Request, env: Env, orderId: string): Promise<Response> {
  try {
    const body = await request.json<{ status: string }>()
    const { status } = body
    const validStatuses = ['pending', 'confirmed', 'preparing', 'delivering', 'completed', 'cancelled']
    if (!validStatuses.includes(status)) {
      return errorResponse('无效的订单状态', 400)
    }
    const now = new Date().toISOString()
    const result = await env.MERCHANT_DB.prepare(
      'UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND merchant_id = ?'
    ).bind(status, now, orderId, env.MERCHANT_ID).run()
    if (result.meta.changes === 0) {
      return errorResponse('订单不存在', 404)
    }
    return jsonResponse({ id: orderId, status, updatedAt: now })
  } catch {
    return errorResponse('更新订单状态失败', 500, 500)
  }
}

export async function handleGetMenu(request: Request, env: Env): Promise<Response> {
  try {
    const result = await env.MERCHANT_DB.prepare(
      'SELECT menu_categories FROM merchant_info WHERE id = ?'
    ).bind(env.MERCHANT_ID).first<{ menu_categories: string } | null>()
    if (!result || !result.menu_categories) {
      return jsonResponse({ categories: [] })
    }
    const categories = JSON.parse(result.menu_categories)
    return jsonResponse({ categories })
  } catch {
    return errorResponse('获取菜单失败', 500, 500)
  }
}
