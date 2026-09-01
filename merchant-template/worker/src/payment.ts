import { Env } from './types'
import { jsonResponse, errorResponse, generateId } from './utils'
import { StripePaymentProvider, mapStripeSessionStatus, mapStripePaymentIntentStatus } from './payment-provider'
import { canTransitionPayment, paymentTransitionError } from './payment-state'
import { canTransitionOrder, orderTransitionError } from './order-state'
import { notifyOrderChanged } from './notify-do'

function getProvider(env: Env): StripePaymentProvider {
  return new StripePaymentProvider(env)
}

export async function createPaymentForOrder(
  env: Env,
  orderId: string,
  origin: string
): Promise<{ paymentId: string; checkoutUrl: string; amountCents: number }> {
  const order = await env.MERCHANT_DB.prepare(
    `SELECT id, merchant_id, total_cents, status, payment_status, currency
     FROM orders WHERE id = ? AND merchant_id = ?`
  ).bind(orderId, env.MERCHANT_ID).first<{
    id: string; merchant_id: string; total_cents: number; status: string; payment_status: string; currency: string;
  } | null>()
  if (!order) throw new Error('订单不存在')
  if (order.total_cents <= 0) throw new Error('订单金额无效')

  const provider = getProvider(env)

  // Re-entrancy guard: if a payment is already open for this order, return it
  // instead of creating a second Stripe Checkout session (prevents double charge).
  if (order.status === 'pending_payment') {
    const existing = await env.MERCHANT_DB.prepare(
      `SELECT id, provider_payment_id FROM payments
       WHERE order_id = ? AND merchant_id = ? AND status IN ('pending','processing')
       ORDER BY created_at DESC LIMIT 1`
    ).bind(orderId, env.MERCHANT_ID).first<{ id: string; provider_payment_id: string | null } | null>()
    if (existing?.provider_payment_id) {
      try {
        const payment = await provider.getPayment(existing.provider_payment_id)
        if (payment.checkoutUrl) {
          return { paymentId: existing.id, checkoutUrl: payment.checkoutUrl, amountCents: order.total_cents }
        }
      } catch {}
    }
  }

  if (!canTransitionOrder(order.status as any, 'pending_payment')) {
    throw new Error(orderTransitionError(order.status as any, 'pending_payment'))
  }

  const successUrl = `${origin}/order-status.html?order_id=${order.id}`
  const cancelUrl = `${origin}/order.html`

  const checkout = await provider.createCheckout({
    orderId: order.id,
    merchantId: env.MERCHANT_ID,
    amountCents: order.total_cents,
    currency: order.currency || 'CAD',
    successUrl,
    cancelUrl,
  })

  const now = new Date().toISOString()
  const paymentId = generateId('pay_')
  await env.MERCHANT_DB.prepare(
    `INSERT INTO payments (id, merchant_id, order_id, provider, provider_payment_id, amount_cents, currency, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'stripe', ?, ?, ?, 'pending', ?, ?, ?)`
  ).bind(
    paymentId, env.MERCHANT_ID, order.id, checkout.providerPaymentId, order.total_cents,
    order.currency || 'CAD', JSON.stringify({ orderId: order.id }), now, now
  ).run()

  await env.MERCHANT_DB.prepare(
    `UPDATE orders SET status = 'pending_payment', payment_status = 'pending', payment_method = 'stripe', updated_at = ? WHERE id = ? AND merchant_id = ?`
  ).bind(now, order.id, env.MERCHANT_ID).run()

  return { paymentId, checkoutUrl: checkout.checkoutUrl, amountCents: order.total_cents }
}

export async function handleCreatePayment(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ orderId: string; method?: string }>()
    const { orderId } = body
    if (!orderId) {
      return errorResponse('缺少订单号', 400)
    }

    const origin = request.headers.get('origin') || `https://${env.MERCHANT_ID}.pages.dev`
    const payment = await createPaymentForOrder(env, orderId, origin)

    return jsonResponse({
      paymentId: payment.paymentId,
      orderId,
      checkoutUrl: payment.checkoutUrl,
      amountCents: payment.amountCents,
      method: 'stripe',
    }, 201)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`创建支付失败: ${msg}`, 500)
  }
}

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const provider = getProvider(env)
    const event = await provider.verifyWebhook(request)

    // Idempotency: UNIQUE(provider, provider_event_id); skip already-processed events.
    const eventId = generateId('evt_')
    const insertResult = await env.MERCHANT_DB.prepare(
      `INSERT INTO payment_events (id, merchant_id, provider, provider_event_id, type, data)
       VALUES (?, ?, 'stripe', ?, ?, ?)`
    ).bind(eventId, env.MERCHANT_ID, event.providerEventId, event.type, JSON.stringify(event.data)).run()

    if (insertResult.meta.changes === 0) {
      return jsonResponse({ received: true, duplicate: true })
    }

    await handleStripeEvent(env, event.type, event.data)

    return jsonResponse({ received: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`Webhook 处理失败: ${msg}`, 400)
  }
}

async function handleStripeEvent(env: Env, type: string, data: any): Promise<void> {
  const now = new Date().toISOString()
  const orderId = data.metadata?.order_id || data.client_reference_id

  if (type === 'checkout.session.completed') {
    const sessionId = data.id
    const provider = getProvider(env)
    let paymentStatus = mapStripeSessionStatus(data)
    if (paymentStatus !== 'succeeded') {
      const payment = await provider.getPayment(sessionId)
      paymentStatus = payment.status
    }
    if (paymentStatus === 'succeeded') {
      await markOrderPaid(env, orderId, sessionId, now)
    }
    return
  }

  if (type === 'payment_intent.succeeded') {
    await markOrderPaid(env, orderId || data.payment_intent?.client_reference_id, data.id, now)
    return
  }

  if (type === 'payment_intent.payment_failed' || type === 'checkout.session.async_payment_failed') {
    await env.MERCHANT_DB.prepare(
      `UPDATE orders SET payment_status = 'failed', updated_at = ? WHERE id = ? AND merchant_id = ?`
    ).bind(now, orderId || '', env.MERCHANT_ID).run()
    return
  }
}

async function markOrderPaid(env: Env, orderId: string, providerPaymentId: string, now: string): Promise<void> {
  if (!orderId) return

  const order = await env.MERCHANT_DB.prepare(
    `SELECT id, merchant_id, status, payment_status FROM orders WHERE id = ? AND merchant_id = ?`
  ).bind(orderId, env.MERCHANT_ID).first<{ id: string; merchant_id: string; status: string; payment_status: string } | null>()
  if (!order) return

  const newPaymentStatus: any = 'succeeded'
  if (order.payment_status !== 'succeeded' && !canTransitionPayment(order.payment_status as any, newPaymentStatus)) {
    return
  }

  const targetOrderStatus: any = 'paid'
  if (!canTransitionOrder(order.status as any, targetOrderStatus)) {
    return
  }

  await env.MERCHANT_DB.prepare(
    `UPDATE payments SET status = 'succeeded', provider_payment_id = COALESCE(provider_payment_id, ?), updated_at = ?
     WHERE order_id = ? AND merchant_id = ? AND status IN ('pending','processing')`
  ).bind(providerPaymentId, now, orderId, env.MERCHANT_ID).run()

  await env.MERCHANT_DB.prepare(
    `UPDATE orders SET status = 'paid', payment_status = 'succeeded', payment_id = ?, updated_at = ?
     WHERE id = ? AND merchant_id = ?`
  ).bind(providerPaymentId, now, orderId, env.MERCHANT_ID).run()

  await notifyOrderChanged(env, {
    type: 'order.paid',
    orderId,
    status: 'paid',
    paymentStatus: 'succeeded',
  })
}

export async function getPaymentStatus(env: Env, orderId: string): Promise<any> {
  const payment = await env.MERCHANT_DB.prepare(
    `SELECT id, provider, provider_payment_id, amount_cents, currency, status, created_at
     FROM payments WHERE order_id = ? AND merchant_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(orderId, env.MERCHANT_ID).first<any | null>()

  const order = await env.MERCHANT_DB.prepare(
    'SELECT status, payment_status, payment_method, payment_id FROM orders WHERE id = ? AND merchant_id = ?'
  ).bind(orderId, env.MERCHANT_ID).first<any | null>()

  if (!order) throw new Error('订单不存在')
  return { orderId, orderStatus: order.status, payment: payment || null, ...order }
}

export async function handleQueryPayment(request: Request, env: Env, orderId: string): Promise<Response> {
  try {
    const data = await getPaymentStatus(env, orderId)
    return jsonResponse(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`查询支付失败: ${msg}`, 500)
  }
}
