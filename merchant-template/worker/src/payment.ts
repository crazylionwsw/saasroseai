import { Env, Order } from './types'
import { jsonResponse, errorResponse } from './utils'

const STRIPE_API = 'https://api.stripe.com/v1'

async function stripeFetch(path: string, secretKey: string, body: Record<string, string>): Promise<any> {
  const resp = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  })
  const data: any = await resp.json()
  if (!resp.ok) {
    throw new Error(data.error?.message || `Stripe error: ${resp.status}`)
  }
  return data
}

export async function handleCreatePayment(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ orderId: string; method: string }>()
    const { orderId, method } = body
    if (!orderId || !method) {
      return errorResponse('Missing required fields (orderId, method)', 400)
    }

    const order = await env.MERCHANT_DB.prepare(
      'SELECT id, total, merchant_id FROM orders WHERE id = ? AND merchant_id = ?'
    ).bind(orderId, env.MERCHANT_ID).first<{ id: string; total: number; merchant_id: string } | null>()
    if (!order) {
      return errorResponse('Order not found', 404)
    }
    if (order.total <= 0) {
      return errorResponse('Invalid order amount', 400)
    }

    const stripeSecretKey = (env as any).STRIPE_SECRET_KEY
    if (!stripeSecretKey) {
      return errorResponse('Payment not configured', 500)
    }

    const domain = request.headers.get('origin') || 'https://saas.roseai.ca'
    const amountInCents = Math.round(order.total * 100)

    if (method === 'stripe') {
      const paymentIntent = await stripeFetch('/payment_intents', stripeSecretKey, {
        amount: String(amountInCents),
        currency: 'cad',
        metadata: JSON.stringify({ order_id: orderId, merchant_id: order.merchant_id }),
        description: `Order #${orderId.slice(0, 8)}`,
        automatic_payment_methods: '{"enabled":true}',
      })

      return jsonResponse({
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        orderId,
        amount: order.total,
        method: 'stripe',
      })
    }

    // Mock WeChat/Alipay for non-Stripe methods
    const paymentUrl = `${domain}/api/payments/mock-checkout?order_id=${orderId}&method=${method}&amount=${order.total}`
    return jsonResponse({ paymentUrl, orderId, amount: order.total, method })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`Payment creation failed: ${msg}`, 500)
  }
}

export async function handlePaymentCallback(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ orderId: string; paymentId: string; status: string }>()
    const { orderId, paymentId, status } = body
    if (!orderId || !paymentId) {
      return errorResponse('Missing required fields', 400)
    }

    // Verify with Stripe if it's a Stripe payment
    const stripeSecretKey = (env as any).STRIPE_SECRET_KEY
    if (status === 'success' && paymentId.startsWith('pi_') && stripeSecretKey) {
      const verifyResp = await fetch(`${STRIPE_API}/payment_intents/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${stripeSecretKey}` },
      })
      const pi: any = await verifyResp.json()
      if (pi.status !== 'succeeded') {
        return jsonResponse({ success: false, message: 'Payment not confirmed by Stripe' })
      }
    }

    if (status !== 'success') {
      return jsonResponse({ success: false, message: 'Payment not successful' })
    }

    const now = new Date().toISOString()
    await env.MERCHANT_DB.prepare(
      `UPDATE orders SET payment_status = 'paid', payment_id = ?,
       status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
       updated_at = ? WHERE id = ? AND merchant_id = ?`
    ).bind(paymentId, now, orderId, env.MERCHANT_ID).run()

    return jsonResponse({ success: true })
  } catch {
    return errorResponse('Payment callback processing failed', 500)
  }
}

export async function handleQueryPayment(request: Request, env: Env, orderId: string): Promise<Response> {
  try {
    const order = await env.MERCHANT_DB.prepare(
      'SELECT payment_status, payment_method, payment_id FROM orders WHERE id = ? AND merchant_id = ?'
    ).bind(orderId, env.MERCHANT_ID).first<{ payment_status: string; payment_method: string | null; payment_id: string | null } | null>()
    if (!order) {
      return errorResponse('Order not found', 404)
    }

    return jsonResponse({ orderId, ...order })
  } catch {
    return errorResponse('Failed to query payment status', 500)
  }
}
