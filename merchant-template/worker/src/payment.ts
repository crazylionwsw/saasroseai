import { Env, Order } from './types'
import { jsonResponse, errorResponse } from './utils'

export async function handleCreatePayment(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ orderId: string; method: string }>()
    const { orderId, method } = body
    if (!orderId || !method) {
      return errorResponse('缺少必填字段 (orderId, method)', 400)
    }
    if (!['wechat', 'alipay'].includes(method)) {
      return errorResponse('不支持的支付方式', 400)
    }
    const order = await env.MERCHANT_DB.prepare(
      'SELECT * FROM orders WHERE id = ? AND merchant_id = ?'
    ).bind(orderId, env.MERCHANT_ID).first<Order | null>()
    if (!order) {
      return errorResponse('订单不存在', 404)
    }
    if (order.paymentStatus === 'paid') {
      return errorResponse('订单已支付', 400)
    }
    const paymentUrl = `https://pay.example.com/pay?order_id=${orderId}&method=${method}&amount=${order.total}`
    return jsonResponse({ paymentUrl, orderId, amount: order.total, method })
  } catch {
    return errorResponse('创建支付失败', 500, 500)
  }
}

export async function handlePaymentCallback(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ orderId: string; paymentId: string; status: string }>()
    const { orderId, paymentId, status } = body
    if (!orderId || !paymentId) {
      return errorResponse('缺少必填字段', 400)
    }
    if (status !== 'success') {
      return jsonResponse({ success: false, message: '支付未成功' })
    }
    const now = new Date().toISOString()
    const order = await env.MERCHANT_DB.prepare(
      'SELECT * FROM orders WHERE id = ? AND merchant_id = ?'
    ).bind(orderId, env.MERCHANT_ID).first<Order | null>()
    if (!order) {
      return errorResponse('订单不存在', 404)
    }
    await env.MERCHANT_DB.prepare(
      `UPDATE orders SET payment_status = 'paid', payment_id = ?, status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END, updated_at = ? WHERE id = ? AND merchant_id = ?`
    ).bind(paymentId, now, orderId, env.MERCHANT_ID).run()
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('支付回调处理失败', 500, 500)
  }
}

export async function handleQueryPayment(request: Request, env: Env, orderId: string): Promise<Response> {
  try {
    const order = await env.MERCHANT_DB.prepare(
      'SELECT payment_status, payment_method, payment_id FROM orders WHERE id = ? AND merchant_id = ?'
    ).bind(orderId, env.MERCHANT_ID).first<{ payment_status: string; payment_method: string | null; payment_id: string | null } | null>()
    if (!order) {
      return errorResponse('订单不存在', 404)
    }
    return jsonResponse({ orderId, ...order })
  } catch {
    return errorResponse('查询支付状态失败', 500, 500)
  }
}
