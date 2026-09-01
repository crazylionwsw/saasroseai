import type { Env } from './types'

// ── Timing-safe string comparison ──
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Constant time for length mismatch too
    let result = a.length ^ b.length
    const minLen = Math.min(a.length, b.length)
    for (let i = 0; i < minLen; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// ── Rate limiter (in-memory, per-IP) ──
interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

const RATE_LIMITS = {
  login: { max: 5, window: 60 * 1000 },        // 5 attempts per minute for login
  api:   { max: 100, window: 60 * 1000 },       // 100 requests per minute for general API
  scrape: { max: 3, window: 60 * 1000 },        // 3 scrapes per minute
  sensitive: { max: 20, window: 60 * 1000 },    // 20 sensitive operations per minute
} as const

export type RateLimitCategory = keyof typeof RATE_LIMITS

export function checkRateLimit(ip: string, category: RateLimitCategory): { allowed: boolean; retryAfter: number } {
  const config = RATE_LIMITS[category]
  const now = Date.now()
  const key = `${ip}:${category}`

  let entry = rateLimitStore.get(key)
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + config.window }
    rateLimitStore.set(key, entry)
    return { allowed: true, retryAfter: 0 }
  }

  entry.count++
  if (entry.count > config.max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfter }
  }

  return { allowed: true, retryAfter: 0 }
}

// Clean up expired entries periodically (called from cron or on demand)
export function cleanupRateLimitStore(): void {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) rateLimitStore.delete(key)
  }
}

// ── Input validation ──
const PHONE_REGEX = /^[+\d][\d\s\-().]{6,20}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateMerchantInput(body: Record<string, any>): ValidationResult {
  const errors: string[] = []

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      errors.push('商户名称不能为空')
    } else if (body.name.length > 50) {
      errors.push('商户名称不能超过50个字符')
    } else if (/<[^>]*>/g.test(body.name)) {
      errors.push('商户名称不能包含HTML标签')
    }
  }

  if (body.phone !== undefined && body.phone !== null) {
    if (!PHONE_REGEX.test(body.phone)) {
      errors.push('手机号格式不正确')
    }
  }

  if (body.email !== undefined && body.email !== null) {
    if (body.email.length > 100) {
      errors.push('邮箱不能超过100个字符')
    } else if (!EMAIL_REGEX.test(body.email)) {
      errors.push('邮箱格式不正确')
    }
  }

  if (body.plan !== undefined) {
    if (!['basic', 'pro', 'enterprise'].includes(body.plan)) {
      errors.push('套餐类型无效')
    }
  }

  if (body.status !== undefined) {
    if (!['active', 'frozen', 'expired', 'deleted'].includes(body.status)) {
      errors.push('状态值无效')
    }
  }

  if (body.days !== undefined) {
    const days = Number(body.days)
    if (isNaN(days) || days < 1 || days > 30) {
      errors.push('有效期必须在1-30天之间')
    }
  }

  return { valid: errors.length === 0, errors }
}

export function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  // Never leak internal paths, SQL, or stack traces
  if (message.includes('D1') || message.includes('SQLITE') || message.includes('database')) {
    return '数据库错误'
  }
  if (message.includes('HMAC') || message.includes('secret') || message.includes('key')) {
    return '内部配置错误'
  }
  if (message.includes('stack') || message.includes('SyntaxError')) {
    return '请求格式错误'
  }
  return '服务器内部错误'
}

// ── Allowed columns whitelist ──
const MERCHANT_UPDATE_COLUMNS = new Set([
  'name', 'email', 'phone', 'status', 'plan',
  'template_id', 'theme_color', 'notes', 'expires_at',
  'cf_account_id', 'cf_api_token',
  'slogan', 'description', 'address', 'business_hours',
  'logo_url', 'cover_url', 'social_media',
  'language', 'currency_symbol',
])

export function isAllowedColumn(col: string): boolean {
  return MERCHANT_UPDATE_COLUMNS.has(col)
}

export function getAllowedColumns(): string[] {
  return Array.from(MERCHANT_UPDATE_COLUMNS)
}

// ── IP extraction ──
export function getClientIP(request: Request): string {
  const cfIP = (request as any).cf?.requestIp
  if (cfIP) return cfIP
  const forwarded = request.headers.get('CF-Connecting-IP')
  if (forwarded) return forwarded
  const xForwarded = request.headers.get('X-Forwarded-For')
  if (xForwarded) return xForwarded.split(',')[0].trim()
  return 'unknown'
}

// ── Audit log ──
export async function logAudit(
  env: Env,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: string,
  ip: string,
): Promise<void> {
  try {
    const id = 'aud-' + crypto.randomUUID().slice(0, 12)
    await env.CENTRAL_DB.prepare(
      'INSERT INTO audit_logs (id, action, target_type, target_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, action, targetType, targetId, detail.slice(0, 500), ip, new Date().toISOString()).run()
  } catch {
    // Silently fail - audit logging should never break the main flow
  }
}

export async function handleListAuditLogs(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    const targetType = url.searchParams.get('targetType')
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50))
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)

    const where: string[] = []
    const params: any[] = []
    if (action) { where.push('action = ?'); params.push(action) }
    if (targetType) { where.push('target_type = ?'); params.push(targetType) }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
    const rows = await env.CENTRAL_DB.prepare(
      `SELECT id, action, target_type, target_id, detail, ip, created_at
       FROM audit_logs${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all()

    const countRow = await env.CENTRAL_DB.prepare(
      `SELECT COUNT(*) as total FROM audit_logs${whereSql}`
    ).bind(...params).first<{ total: number }>()

    return new Response(JSON.stringify({
      logs: rows.results || [],
      total: countRow?.total || 0,
      limit,
      offset,
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ logs: [], total: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }
}
