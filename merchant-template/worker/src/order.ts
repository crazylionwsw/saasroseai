import { Env, Order, OrderType } from './types'
import { jsonResponse, errorResponse, generateOrderId, paginate } from './utils'
import { calculateQuote } from './pricing'
import { canTransitionOrder, orderTransitionError, isInternalOrderStatus } from './order-state'
import { verifyTableToken } from './qr'

export async function handleCreateOrder(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{
      orderType?: string;
      tableId?: string;
      qrToken?: string;
      customerName?: string;
      customerPhone?: string;
      customerAddress?: string;
      note?: string;
      tipPercent?: number;
      items: { id: string | number; qty: number; modifiers?: string[] }[];
    }>()

    const items = body.items
    if (!Array.isArray(items) || items.length === 0) {
      return errorResponse('缺少菜品 (items)', 400)
    }

    const orderType: OrderType = body.orderType === 'dine_in' ? 'dine_in' : 'pickup'

    let tableId = body.tableId || null
    if (body.qrToken) {
      const verified = await verifyTableToken(env, body.qrToken)
      if (!verified) {
        return errorResponse('二维码无效或已过期', 400)
      }
      tableId = verified.t || tableId
    }
    if (orderType === 'dine_in' && !tableId) {
      return errorResponse('堂食订单缺少桌号', 400)
    }

    const quote = await calculateQuote(env, items, body.tipPercent)
    const now = new Date().toISOString()
    const orderId = generateOrderId()

    let paymentEnabled = false
    try {
      const info = await env.MERCHANT_DB.prepare(
        'SELECT enable_payment, enable_ordering FROM merchant_info WHERE id = ?'
      ).bind(env.MERCHANT_ID).first<{ enable_payment: number | null; enable_ordering: number | null }>()
      paymentEnabled = (info?.enable_payment ?? 0) === 1
    } catch {}
    const requiresPayment = quote.totalCents > 0 && paymentEnabled

    const lineJson = JSON.stringify(quote.lines)
    const itemNames = quote.lines.map((l) => `${l.name}x${l.qty}`).join(', ')

    await env.MERCHANT_DB.prepare(
      `INSERT INTO orders (
         id, merchant_id, order_number, order_type, table_id,
         customer_name, customer_phone, customer_address, items, note,
         subtotal, total,
         subtotal_cents, tax_cents, tip_cents, total_cents, currency,
         status, payment_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId, env.MERCHANT_ID, orderId, orderType, tableId,
      body.customerName || null, body.customerPhone || null, body.customerAddress || null, lineJson, body.note || null,
      quote.subtotalCents / 100, quote.totalCents / 100,
      quote.subtotalCents, quote.taxCents, quote.tipCents, quote.totalCents, quote.currency,
      requiresPayment ? 'draft' : 'paid',
      'not_required',
      now, now
    ).run()

    return jsonResponse({
      id: orderId,
      orderId,
      orderType,
      tableId,
      items: quote.lines,
      itemNames,
      subtotalCents: quote.subtotalCents,
      taxCents: quote.taxCents,
      tipCents: quote.tipCents,
      totalCents: quote.totalCents,
      currency: quote.currency,
      status: requiresPayment ? 'draft' : 'paid',
      paymentStatus: 'not_required',
      requiresPayment,
      createdAt: now,
    }, 201)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`创建订单失败: ${msg}`, 400)
  }
}

export async function handleCalculateQuote(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{
      items: { id: string | number; qty: number; modifiers?: string[] }[];
      tipPercent?: number;
    }>()
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return errorResponse('缺少菜品 (items)', 400)
    }
    const quote = await calculateQuote(env, body.items, body.tipPercent)
    return jsonResponse(quote)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`价格计算失败: ${msg}`, 400)
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

    const current = await env.MERCHANT_DB.prepare(
      'SELECT status, payment_status FROM orders WHERE id = ? AND merchant_id = ?'
    ).bind(orderId, env.MERCHANT_ID).first<{ status: string; payment_status: string } | null>()
    if (!current) {
      return errorResponse('订单不存在', 404)
    }

    const from = current.status as any
    const to = status as any
    if (!canTransitionOrder(from, to)) {
      return errorResponse(orderTransitionError(from, to), 409)
    }
    if (isInternalOrderStatus(to)) {
      return errorResponse('该状态由系统自动变更', 403)
    }

    const now = new Date().toISOString()
    await env.MERCHANT_DB.prepare(
      'UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND merchant_id = ?'
    ).bind(status, now, orderId, env.MERCHANT_ID).run()

    return jsonResponse({ id: orderId, status, updatedAt: now })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`更新订单状态失败: ${msg}`, 500)
  }
}

export async function handleGetMenu(request: Request, env: Env): Promise<Response> {
  try {
    const row = await env.MERCHANT_DB.prepare(
      'SELECT menu_categories FROM merchant_info WHERE id = ?'
    ).bind(env.MERCHANT_ID).first<{ menu_categories: string | null }>()
    let categories: any[] = []
    try {
      const parsed = row?.menu_categories ? JSON.parse(row.menu_categories) : []
      categories = Array.isArray(parsed) ? parsed : parsed.categories || []
    } catch {}

    const items = categories.flatMap((cat: any) =>
      (cat?.items || []).map((it: any) => ({ ...it, category: cat?.name || 'Menu' }))
    )
    return jsonResponse({ categories, items })
  } catch {
    return errorResponse('获取菜单失败', 500, 500)
  }
}
