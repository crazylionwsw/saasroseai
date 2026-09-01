import { Env, PaymentProvider, CheckoutResult, PaymentResult, RefundResult, WebhookEvent, PaymentStatus } from './types'

const SQUARE_API = 'https://connect.squareup.com'

async function squareFetch(path: string, accessToken: string, options: RequestInit = {}): Promise<any> {
  const resp = await fetch(`${SQUARE_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-11-20',
      ...(options.headers || {}),
    },
  })
  const data: any = await resp.json()
  if (!resp.ok) {
    const err = data?.errors?.[0]?.detail || data?.message || `Square error: ${resp.status}`
    throw new Error(err)
  }
  return data
}

function mapSquareStatus(status?: string): PaymentStatus {
  switch (status) {
    case 'COMPLETED': return 'succeeded'
    case 'CANCELED': return 'cancelled'
    case 'FAILED': return 'failed'
    default: return 'pending'
  }
}

export async function getSquareAccessToken(env: Env): Promise<string | null> {
  if (env.SQUARE_ACCESS_TOKEN) return env.SQUARE_ACCESS_TOKEN
  try {
    const row = await env.MERCHANT_DB.prepare(
      `SELECT metadata FROM payment_accounts WHERE merchant_id = ? AND provider = 'square' AND status = 'active'`
    ).bind(env.MERCHANT_ID).first<{ metadata: string | null } | null>()
    if (row?.metadata) {
      const meta = JSON.parse(row.metadata)
      if (meta.accessToken) return meta.accessToken
    }
  } catch {}
  return null
}

export class SquarePaymentProvider implements PaymentProvider {
  constructor(private env: Env) {}

  private async token(): Promise<string> {
    const t = await getSquareAccessToken(this.env)
    if (!t) throw new Error('Square 未连接')
    return t
  }

  async createCheckout(params: {
    orderId: string;
    merchantId: string;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    connectedAccountId?: string;
  }): Promise<CheckoutResult> {
    const locationId = (this.env as any).SQUARE_LOCATION_ID
    if (!locationId) throw new Error('Square 未配置 Location')
    const body = {
      idempotency_key: `rose_${params.orderId}`,
      quick_pay: {
        name: `Order #${params.orderId}`,
        price_money: { amount: params.amountCents, currency: params.currency },
        location_id: locationId,
      },
      redirect_url: params.successUrl,
    }
    const res = await squareFetch('/v2/online-checkout/payment-links', await this.token(), {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { checkoutUrl: res.payment_link?.url, providerPaymentId: res.payment_link?.id }
  }

  async getPayment(providerPaymentId: string): Promise<PaymentResult> {
    const res = await squareFetch(`/v2/online-checkout/payment-links/${providerPaymentId}`, await this.token())
    const link = res.payment_link || {}
    return {
      providerPaymentId,
      status: mapSquareStatus(link.status),
      amountCents: link.quick_pay?.price_money?.amount || 0,
      currency: link.quick_pay?.price_money?.currency || 'CAD',
    }
  }

  async refund(providerPaymentId: string, amountCents: number, reason?: string): Promise<RefundResult> {
    const body: any = {
      idempotency_key: `refund_${providerPaymentId}_${Date.now()}`,
      amount_money: { amount: amountCents, currency: 'CAD' },
      payment_id: providerPaymentId,
    }
    if (reason) body.reason = reason
    const res = await squareFetch('/v2/refunds', await this.token(), { method: 'POST', body: JSON.stringify(body) })
    return { providerRefundId: res.refund?.id, amountCents: res.refund?.amount_money?.amount || amountCents }
  }

  async verifyWebhook(request: Request): Promise<WebhookEvent> {
    const signatureKey = (this.env as any).SQUARE_WEBHOOK_SIGNATURE_KEY
    if (!signatureKey) throw new Error('Square Webhook 未配置')
    const raw = await request.text()
    const provided = request.headers.get('X-Square-Signature')
    if (!provided) throw new Error('缺少 X-Square-Signature 头')

    const payload = JSON.parse(raw) as { type?: string; timestamp?: string; merchant_id?: string; data?: any }
    const message = raw + (payload.timestamp || '')
    const expected = await hmacSha256Base64(signatureKey, message)
    if (!constantTimeEqual(provided, expected)) throw new Error('Square Webhook 签名验证失败')

    return {
      providerEventId: payload.data?.id || payload.data?.payment?.id || raw.slice(0, 64),
      type: payload.type || '',
      data: payload.data || {},
    }
  }
}

export async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const msg = new TextEncoder().encode(message)
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg)
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
