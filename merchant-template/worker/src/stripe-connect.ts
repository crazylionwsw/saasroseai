import { Env } from './types'
import { jsonResponse, errorResponse } from './utils'

const STRIPE_CONNECT = 'https://connect.stripe.com'

async function hmacB64url(secret: string, message: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const msg = new TextEncoder().encode(message)
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg)
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlEncode(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
  return atob(padded)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function signState(env: Env, merchantId: string, nonce: string): Promise<string> {
  const payload = b64urlEncode(JSON.stringify({ m: merchantId, n: nonce, exp: Math.floor(Date.now() / 1000) + 3600 }))
  const sig = await hmacB64url(env.MERCHANT_TOKEN || 'connect', payload)
  return `${payload}.${sig}`
}

async function verifyState(env: Env, state: string): Promise<{ m: string; n: string } | null> {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [payload, sig] = parts
  const expected = await hmacB64url(env.MERCHANT_TOKEN || 'connect', payload)
  if (!constantTimeEqual(sig, expected)) return null
  try {
    const parsed = JSON.parse(b64urlDecode(payload)) as { m: string; n: string; exp: number }
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null
    if (parsed.m !== env.MERCHANT_ID) return null
    return parsed
  } catch {
    return null
  }
}

export async function handleStartStripeConnect(request: Request, env: Env): Promise<Response> {
  try {
    const clientId = (env as any).STRIPE_CLIENT_ID
    if (!clientId) return errorResponse('Stripe Connect 未配置 (STRIPE_CLIENT_ID)', 500)

    const nonce = crypto.randomUUID()
    const state = await signState(env, env.MERCHANT_ID, nonce)
    const origin = request.headers.get('origin') || `https://${env.MERCHANT_ID}.pages.dev`
    const redirectUri = `${origin}/api/stripe/connect/callback`

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'read_write',
      state,
      redirect_uri: redirectUri,
    })

    return jsonResponse({
      authorizeUrl: `${STRIPE_CONNECT}/oauth/authorize?${params.toString()}`,
      redirectUri,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`发起 Stripe Connect 失败: ${msg}`, 500)
  }
}

export async function handleStripeConnectCallback(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (error) {
      return htmlResponse(false, `Stripe Connect 失败: ${error}`)
    }
    if (!code || !state) {
      return htmlResponse(false, '缺少 code 或 state 参数')
    }
    const verified = await verifyState(env, state)
    if (!verified) {
      return htmlResponse(false, 'state 校验失败或已过期')
    }

    const clientId = (env as any).STRIPE_CLIENT_ID
    const clientSecret = env.STRIPE_SECRET_KEY
    if (!clientId || !clientSecret) {
      return htmlResponse(false, 'Stripe Connect 未配置')
    }

    const resp = await fetch(`${STRIPE_CONNECT}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }).toString(),
    })
    const data: any = await resp.json()
    if (!resp.ok || !data.stripe_user_id) {
      return htmlResponse(false, `Stripe OAuth 交换失败: ${data.error_description || data.error || resp.status}`)
    }

    await env.MERCHANT_DB.prepare(
      `INSERT OR REPLACE INTO payment_accounts (merchant_id, provider, provider_account_id, status, connected_at, metadata)
       VALUES (?, 'stripe', ?, 'active', datetime('now'), ?)`
    ).bind(env.MERCHANT_ID, data.stripe_user_id, JSON.stringify({ livemode: !!data.livemode })).run()

    return htmlResponse(true, 'Stripe 已成功连接！现在可以在线收款。')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return htmlResponse(false, `Stripe Connect 回调处理失败: ${msg}`)
  }
}

export async function getConnectedStripeAccount(env: Env): Promise<string | null> {
  try {
    const row = await env.MERCHANT_DB.prepare(
      `SELECT provider_account_id FROM payment_accounts WHERE merchant_id = ? AND provider = 'stripe' AND status = 'active'`
    ).bind(env.MERCHANT_ID).first<{ provider_account_id: string } | null>()
    return row?.provider_account_id || null
  } catch {
    return null
  }
}

function htmlResponse(ok: boolean, message: string): Response {
  const icon = ok ? '✅' : '❌'
  return new Response(`<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stripe Connect</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f6fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);padding:40px;text-align:center;max-width:420px"><div style="font-size:40px">${icon}</div><h2 style="margin:16px 0 8px;color:#2d3436">${message}</h2><a href="/" style="display:inline-block;margin-top:16px;color:#667eea;text-decoration:none;font-weight:600">返回商户后台</a></div></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
