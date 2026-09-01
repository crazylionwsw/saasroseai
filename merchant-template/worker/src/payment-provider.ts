import { Env, PaymentProvider, CheckoutResult, PaymentResult, RefundResult, WebhookEvent, PaymentStatus } from './types'

const STRIPE_API = 'https://api.stripe.com/v1'

async function stripeGet(path: string, secretKey: string): Promise<any> {
  const resp = await fetch(`${STRIPE_API}${path}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  })
  const data: any = await resp.json()
  if (!resp.ok) throw new Error(data.error?.message || `Stripe error: ${resp.status}`)
  return data
}

async function stripePost(path: string, secretKey: string, body: Record<string, string>): Promise<any> {
  const resp = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  })
  const data: any = await resp.json()
  if (!resp.ok) throw new Error(data.error?.message || `Stripe error: ${resp.status}`)
  return data
}

export class StripePaymentProvider implements PaymentProvider {
  constructor(private env: Env) {}

  async createCheckout(params: {
    orderId: string;
    merchantId: string;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutResult> {
    const secretKey = this.env.STRIPE_SECRET_KEY
    if (!secretKey) throw new Error('支付未配置')
    const session = await stripePost('/checkout/sessions', secretKey, {
      mode: 'payment',
      currency: params.currency.toLowerCase(),
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': params.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(params.amountCents),
      'line_items[0][price_data][product_data][name]': `Order #${params.orderId}`,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      client_reference_id: params.orderId,
      metadata: JSON.stringify({ order_id: params.orderId, merchant_id: params.merchantId }),
    })
    return { checkoutUrl: session.url, providerPaymentId: session.id }
  }

  async getPayment(providerPaymentId: string): Promise<PaymentResult> {
    const secretKey = this.env.STRIPE_SECRET_KEY
    if (!secretKey) throw new Error('支付未配置')
    if (providerPaymentId.startsWith('cs_')) {
      const session = await stripeGet(`/checkout/sessions/${providerPaymentId}`, secretKey)
      return {
        providerPaymentId: session.id,
        status: mapStripeSessionStatus(session),
        amountCents: session.amount_total,
        currency: session.currency,
        checkoutUrl: session.url || undefined,
      }
    }
    const pi = await stripeGet(`/payment_intents/${providerPaymentId}`, secretKey)
    return {
      providerPaymentId: pi.id,
      status: mapStripePaymentIntentStatus(pi),
      amountCents: pi.amount,
      currency: pi.currency,
    }
  }

  async refund(providerPaymentId: string, amountCents: number, reason?: string): Promise<RefundResult> {
    const secretKey = this.env.STRIPE_SECRET_KEY
    if (!secretKey) throw new Error('支付未配置')
    let paymentIntentId = providerPaymentId
    if (providerPaymentId.startsWith('cs_')) {
      const session = await stripeGet(`/checkout/sessions/${providerPaymentId}`, secretKey)
      paymentIntentId = session.payment_intent || paymentIntentId
    }
    const body: Record<string, string> = { payment_intent: paymentIntentId, amount: String(amountCents) }
    if (reason) body.reason = reason
    const refund = await stripePost('/refunds', secretKey, body)
    return { providerRefundId: refund.id, amountCents: refund.amount }
  }

  async verifyWebhook(request: Request): Promise<WebhookEvent> {
    const secret = this.env.STRIPE_WEBHOOK_SECRET
    if (!secret) throw new Error('Webhook 未配置')
    const signatureHeader = request.headers.get('Stripe-Signature')
    if (!signatureHeader) throw new Error('缺少 Stripe-Signature 头')
    const rawBody = await request.text()
    const verified = await verifyStripeSignature(rawBody, signatureHeader, secret)
    if (!verified) throw new Error('Webhook 签名验证失败')

    const payload = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data?: { object?: any };
    }
    return {
      providerEventId: payload.id,
      type: payload.type,
      data: payload.data?.object || {},
    }
  }
}

export function mapStripePaymentIntentStatus(pi: any): PaymentStatus {
  switch (pi.status) {
    case 'succeeded': return 'succeeded'
    case 'processing': return 'processing'
    case 'canceled': return 'cancelled'
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
      return 'pending'
    default: return 'failed'
  }
}

export function mapStripeSessionStatus(session: any): PaymentStatus {
  switch (session.payment_status) {
    case 'paid': return 'succeeded'
    case 'processing': return 'processing'
    case 'unpaid': return 'pending'
    default: return 'pending'
  }
}

export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): Promise<boolean> {
  const parts = new Map<string, string>()
  for (const item of signatureHeader.split(',')) {
    const [k, ...rest] = item.trim().split('=')
    if (k) parts.set(k, rest.join('='))
  }
  const timestamp = parts.get('t')
  const signatures = parts.get('v1')
  if (!timestamp || !signatures) return false

  const signedPayload = `${timestamp}.${rawBody}`
  const expected = await hmacSha256Hex(webhookSecret, signedPayload)
  const provided = signatures.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)

  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - Number(timestamp)) > 300) return false

  return provided.some((sig) => constantTimeEqual(sig, expected))
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const msg = new TextEncoder().encode(message)
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg)
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
