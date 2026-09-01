import { Env } from './types'
import { jsonResponse, errorResponse, generateId } from './utils'

interface TableTokenPayload {
  m: string;
  t: string;
  exp: number;
}

export function generateTableToken(env: Env, tableId: string, ttlSec = 60 * 60 * 24 * 7): Promise<string> {
  return signToken(env, { m: env.MERCHANT_ID, t: tableId, exp: Math.floor(Date.now() / 1000) + ttlSec })
}

export async function verifyTableToken(env: Env, token: string): Promise<TableTokenPayload | null> {
  const payload = await verifyToken(env, token)
  if (!payload) return null
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  if (payload.m !== env.MERCHANT_ID) return null
  return payload
}

async function signToken(env: Env, payload: TableTokenPayload): Promise<string> {
  const secret = env.MERCHANT_TOKEN || 'qr'
  const body = b64urlEncode(JSON.stringify(payload))
  const sig = await hmacB64url(secret, body)
  return `${body}.${sig}`
}

async function verifyToken(env: Env, token: string): Promise<TableTokenPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const secret = env.MERCHANT_TOKEN || 'qr'
  const expected = await hmacB64url(secret, body)
  if (!constantTimeEqual(sig, expected)) return null
  try {
    return JSON.parse(b64urlDecode(body)) as TableTokenPayload
  } catch {
    return null
  }
}

export async function handleGenerateQr(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json<any>().catch(() => ({}))) as { tableId?: string; tableName?: string }
    const tableId = body.tableId || generateId('tbl_')
    const token = await generateTableToken(env, tableId)

    const origin = request.headers.get('origin') || `https://${env.MERCHANT_ID}.pages.dev`
    const orderUrl = `${origin}/order.html?qr=${encodeURIComponent(token)}`
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(orderUrl)}`

    return jsonResponse({
      tableId,
      tableName: body.tableName || null,
      token,
      orderUrl,
      qrImageUrl,
      expiresInSec: 60 * 60 * 24 * 7,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`生成二维码失败: ${msg}`, 500)
  }
}

export async function handleVerifyQr(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const token = url.searchParams.get('token') || ''
    const payload = await verifyTableToken(env, token)
    if (!payload) {
      return errorResponse('二维码无效或已过期', 400)
    }
    return jsonResponse({ valid: true, tableId: payload.t })
  } catch {
    return errorResponse('二维码校验失败', 500)
  }
}

function b64urlEncode(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
  return atob(padded)
}

async function hmacB64url(secret: string, message: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const msg = new TextEncoder().encode(message)
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg)
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
