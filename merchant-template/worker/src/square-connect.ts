import { Env } from './types'
import { jsonResponse, errorResponse } from './utils'

const SQUARE_CONNECT = 'https://connect.squareup.com'

export async function handleStartSquareConnect(request: Request, env: Env): Promise<Response> {
  try {
    const clientId = (env as any).SQUARE_CLIENT_ID
    if (!clientId) return errorResponse('Square OAuth 未配置 (SQUARE_CLIENT_ID)', 500)

    const origin = request.headers.get('origin') || `https://${env.MERCHANT_ID}.pages.dev`
    const redirectUri = `${origin}/api/square/connect/callback`
    const state = await squareState(env)

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'MERCHANT_PROFILE_READ PAYMENTS_READ PAYMENTS_WRITE',
      redirect_uri: redirectUri,
      state,
    })

    return jsonResponse({ authorizeUrl: `${SQUARE_CONNECT}/oauth2/authorize?${params.toString()}`, redirectUri })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`发起 Square OAuth 失败: ${msg}`, 500)
  }
}

export async function handleSquareConnectCallback(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (error) return squareHtml(false, `Square OAuth 失败: ${error}`)
    if (!code || !state) return squareHtml(false, '缺少 code 或 state 参数')
    const valid = await verifySquareState(env, state)
    if (!valid) return squareHtml(false, 'state 校验失败或已过期')

    const clientId = (env as any).SQUARE_CLIENT_ID
    const clientSecret = (env as any).SQUARE_CLIENT_SECRET
    if (!clientId || !clientSecret) return squareHtml(false, 'Square OAuth 未配置')

    const resp = await fetch(`${SQUARE_CONNECT}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': '2024-11-20' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    })
    const data: any = await resp.json()
    if (!resp.ok || !data.access_token) {
      return squareHtml(false, `Square 令牌交换失败: ${data.error_description || data.error || resp.status}`)
    }

    const merchantId = data.merchant_id || ''
    await env.MERCHANT_DB.prepare(
      `INSERT OR REPLACE INTO payment_accounts (merchant_id, provider, provider_account_id, status, connected_at, metadata)
       VALUES (?, 'square', ?, 'active', datetime('now'), ?)`
    ).bind(env.MERCHANT_ID, merchantId || env.MERCHANT_ID, JSON.stringify({ accessToken: data.access_token })).run()

    return squareHtml(true, 'Square 已成功连接！现在可以在线收款。')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return squareHtml(false, `Square 回调处理失败: ${msg}`)
  }
}

async function squareState(env: Env): Promise<string> {
  const payload = b64url(JSON.stringify({ m: env.MERCHANT_ID, exp: Math.floor(Date.now() / 1000) + 3600 }))
  const sig = await hmac(env.MERCHANT_TOKEN || 'square', payload)
  return `${payload}.${sig}`
}

async function verifySquareState(env: Env, state: string): Promise<boolean> {
  const parts = state.split('.')
  if (parts.length !== 2) return false
  const [payload, sig] = parts
  const expected = await hmac(env.MERCHANT_TOKEN || 'square', payload)
  if (sig !== expected) return false
  try {
    const parsed = JSON.parse(b64urlDecode(payload)) as { m: string; exp: number }
    if (parsed.exp < Math.floor(Date.now() / 1000)) return false
    return parsed.m === env.MERCHANT_ID
  } catch {
    return false
  }
}

function b64url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
  return atob(padded)
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const msg = new TextEncoder().encode(message)
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg)
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function squareHtml(ok: boolean, message: string): Response {
  const icon = ok ? '✅' : '❌'
  return new Response(`<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>Square Connect</title></head><body style="font-family:-apple-system,sans-serif;background:#f5f6fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);padding:40px;text-align:center;max-width:420px"><div style="font-size:40px">${icon}</div><h2 style="margin:16px 0 8px;color:#2d3436">${message}</h2><a href="/" style="display:inline-block;margin-top:16px;color:#667eea;text-decoration:none;font-weight:600">返回商户后台</a></div></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
