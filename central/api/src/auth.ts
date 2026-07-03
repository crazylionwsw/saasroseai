import { SignJWT, jwtVerify } from 'jose'
import type { Env } from './types'

export async function generateToken(merchantId: string, plan: string, env: Env, expiresIn = '24h'): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET)
  const token = await new SignJWT({ merchantId, plan, role: 'merchant' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret)
  return token
}

export async function verifyToken(token: string, env: Env): Promise<{ merchantId: string; plan: string; role: string } | null> {
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET)
    const { payload } = await jwtVerify(token, secret)
    return {
      merchantId: payload.merchantId as string,
      plan: payload.plan as string,
      role: (payload.role as string) || 'merchant',
    }
  } catch {
    return null
  }
}

export async function generateAdminToken(env: Env, days: number): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET)
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secret)
  return token
}

export async function verifyAdminToken(token: string, env: Env): Promise<{ role: string } | null> {
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET)
    const { payload } = await jwtVerify(token, secret)
    if (payload.role !== 'admin') return null
    return { role: 'admin' }
  } catch {
    return null
  }
}

export async function hashToken(token: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
