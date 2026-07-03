import { IRequest } from 'itty-router'
import { Env, AuthResult } from './types'

const SECURITY_HEADERS = {
  'content-type': 'application/json',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-xss-protection': '0',
}

export async function verifyMerchant(env: Env): Promise<AuthResult> {
  try {
    const resp = await fetch(env.CENTRAL_AUTH_URL + '/api/merchants/verify', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MERCHANT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    })
    if (!resp.ok) {
      return { status: 'error', merchantId: '', plan: '' }
    }
    const data = await resp.json<AuthResult>()
    return data
  } catch {
    return { status: 'error', merchantId: '', plan: '' }
  }
}

export function withAuth(env: Env) {
  return async (request: IRequest): Promise<Response | undefined> => {
    const result = await verifyMerchant(env)
    if (result.status !== 'active') {
      return new Response(JSON.stringify({ error: '商户已停用', code: 403 }), {
        status: 403,
        headers: { ...SECURITY_HEADERS },
      })
    }
    ;(request as any).merchantInfo = result
    return undefined
  }
}
