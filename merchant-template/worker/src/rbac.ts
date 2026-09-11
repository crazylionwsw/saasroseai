import { Env } from './types'
import { jsonResponse, errorResponse, generateId } from './utils'

export type StaffRole = 'owner' | 'manager' | 'staff'

const ROLE_RANK: Record<StaffRole, number> = { staff: 1, manager: 2, owner: 3 }

export function hasRole(role: string, required: StaffRole): boolean {
  const r = ROLE_RANK[role as StaffRole] || 0
  return r >= ROLE_RANK[required]
}

const SESSION_COOKIE = 'rose_staff'
const SESSION_TTL_DAYS = 7

async function pbkdf2Hex(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface StaffSession {
  userId: string
  merchantId: string
  email: string
  role: StaffRole
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function countStaffUsers(env: Env): Promise<number> {
  const row = await env.MERCHANT_DB.prepare(
    'SELECT COUNT(*) as c FROM staff_users WHERE merchant_id = ?'
  ).bind(env.MERCHANT_ID).first<{ c: number }>()
  return row?.c || 0
}

export async function createStaffUser(env: Env, email: string, password: string, role: StaffRole): Promise<string> {
  const salt = randomToken().slice(0, 32)
  const hash = await pbkdf2Hex(password, salt)
  const id = generateId('usr_')
  await env.MERCHANT_DB.prepare(
    `INSERT INTO staff_users (id, merchant_id, email, role, password_hash, salt, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).bind(id, env.MERCHANT_ID, email.toLowerCase(), role, hash, salt).run()
  return id
}

export async function createSession(env: Env, user: { id: string; email: string; role: string }): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString()
  await env.MERCHANT_DB.prepare(
    `INSERT INTO staff_sessions (token_hash, user_id, merchant_id, role, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(tokenHash, user.id, env.MERCHANT_ID, user.role, expiresAt).run()
  return { token, expiresAt }
}

function extractToken(request: Request): string | null {
  const auth = request.headers.get('Authorization')
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim()
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

export async function getSession(request: Request, env: Env): Promise<StaffSession | null> {
  const token = extractToken(request)
  if (!token) return null
  const tokenHash = await sha256Hex(token)
  const row = await env.MERCHANT_DB.prepare(
    `SELECT s.user_id, s.merchant_id, s.role, s.expires_at, u.email
     FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.merchant_id = ? AND u.is_active = 1`
  ).bind(tokenHash, env.MERCHANT_ID).first<{ user_id: string; merchant_id: string; role: string; expires_at: string; email: string } | null>()
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  return { userId: row.user_id, merchantId: row.merchant_id, email: row.email, role: row.role as StaffRole }
}

function sessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
}

// --- Handlers ---

export async function handleSetup(request: Request, env: Env): Promise<Response> {
  try {
    const setupToken = request.headers.get('X-Setup-Token') || ''
    if (!env.MERCHANT_TOKEN || !constantTimeEqual(setupToken, env.MERCHANT_TOKEN)) {
      return errorResponse('缺少或无效的初始化令牌', 403, 403)
    }
    if (await countStaffUsers(env) > 0) {
      return errorResponse('已初始化，禁止重复创建', 409, 409)
    }
    const body = await request.json<{ email?: string; password?: string }>()
    const email = (body.email || '').trim().toLowerCase()
    const password = body.password || ''
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errorResponse('邮箱格式无效', 400)
    if (password.length < 8) return errorResponse('密码至少 8 位', 400)

    const id = await createStaffUser(env, email, password, 'owner')
    const session = await createSession(env, { id, email, role: 'owner' })
    return new Response(JSON.stringify({ success: true, role: 'owner', token: session.token, expiresAt: session.expiresAt }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(session.token, SESSION_TTL_DAYS * 86400) },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`初始化失败: ${msg}`, 500, 500)
  }
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ email?: string; password?: string }>()
    const email = (body.email || '').trim().toLowerCase()
    const password = body.password || ''
    if (!email || !password) return errorResponse('缺少邮箱或密码', 400)

    const user = await env.MERCHANT_DB.prepare(
      'SELECT id, email, role, password_hash, salt, is_active FROM staff_users WHERE merchant_id = ? AND email = ?'
    ).bind(env.MERCHANT_ID, email).first<{ id: string; email: string; role: string; password_hash: string; salt: string; is_active: number } | null>()

    // Constant-time-ish: always compute hash to avoid user enumeration timing.
    const salt = user?.salt || 'unknown'
    const computed = await pbkdf2Hex(password, salt)
    if (!user || user.is_active !== 1 || !constantTimeEqual(computed, user.password_hash)) {
      return errorResponse('邮箱或密码错误', 401, 401)
    }

    const session = await createSession(env, { id: user.id, email: user.email, role: user.role })
    return new Response(JSON.stringify({ success: true, role: user.role, email: user.email, token: session.token, expiresAt: session.expiresAt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(session.token, SESSION_TTL_DAYS * 86400) },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`登录失败: ${msg}`, 500, 500)
  }
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  try {
    const token = extractToken(request)
    if (token) {
      const tokenHash = await sha256Hex(token)
      await env.MERCHANT_DB.prepare('DELETE FROM staff_sessions WHERE token_hash = ?').bind(tokenHash).run()
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` },
    })
  } catch {
    return errorResponse('登出失败', 500, 500)
  }
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env)
  if (!session) return errorResponse('未登录', 401, 401)
  return jsonResponse({ email: session.email, role: session.role, merchantId: session.merchantId })
}

export async function handleListStaff(request: Request, env: Env): Promise<Response> {
  const rows = await env.MERCHANT_DB.prepare(
    'SELECT id, email, role, is_active, created_at FROM staff_users WHERE merchant_id = ? ORDER BY created_at ASC'
  ).bind(env.MERCHANT_ID).all()
  return jsonResponse({ users: rows.results || [] })
}

export async function handleCreateStaff(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ email?: string; password?: string; role?: string }>()
    const email = (body.email || '').trim().toLowerCase()
    const password = body.password || ''
    const role = body.role as StaffRole
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errorResponse('邮箱格式无效', 400)
    if (password.length < 8) return errorResponse('密码至少 8 位', 400)
    if (!['owner', 'manager', 'staff'].includes(role)) return errorResponse('角色无效', 400)
    const id = await createStaffUser(env, email, password, role)
    return jsonResponse({ success: true, id, email, role }, 201)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`创建员工失败: ${msg}`, 400)
  }
}

// --- Route authorization ---

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/menu',
  '/api/cart/calculate',
  '/api/payments/create',
  '/api/payments/webhook',
  '/api/payments/webhook/square',
  '/api/qr/verify',
])

function isPublic(pathname: string, method: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (pathname.startsWith('/api/cart')) return true
  if (pathname.startsWith('/api/storefront/')) return true
  if (pathname === '/api/orders' && method === 'POST') return true
  if (/^\/api\/orders\/[^/]+$/.test(pathname) && method === 'GET') return true
  if (/^\/api\/payments\/[^/]+$/.test(pathname) && method === 'GET') return true
  return false
}

function requiredRole(pathname: string, method: string): StaffRole | null {
  if (pathname === '/api/auth/me') return null
  if (/^\/api\/(stripe|square)\/connect/.test(pathname)) return 'owner'
  if (pathname === '/api/usage') return 'owner'
  if (pathname.startsWith('/api/staff')) return 'owner'
  if (
    pathname.startsWith('/api/merchant/profile') ||
    pathname.startsWith('/api/merchant/menu') ||
    pathname.startsWith('/api/merchant/tax') ||
    pathname.startsWith('/api/merchant/knowledge') ||
    pathname.startsWith('/api/merchant/analytics') ||
    pathname.startsWith('/api/stores') ||
    pathname.startsWith('/api/inventory') ||
    pathname.startsWith('/api/suppliers') ||
    (pathname === '/api/qr' && method === 'POST')
  ) return 'manager'
  // orders list/status, stats, reports, deliveries
  return 'staff'
}

export async function authorizeMerchantRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (isPublic(url.pathname, request.method)) return null
  if (!url.pathname.startsWith('/api/')) return null

  const session = await getSession(request, env)
  if (!session) {
    return new Response(JSON.stringify({ error: '未授权，请登录', code: 401 }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const required = requiredRole(url.pathname, request.method)
  if (required && !hasRole(session.role, required)) {
    return new Response(JSON.stringify({ error: '权限不足', code: 403 }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}
