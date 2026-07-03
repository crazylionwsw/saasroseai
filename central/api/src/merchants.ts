import type { Env, Merchant } from './types'
import { generateToken, verifyToken, hashToken } from './auth'
import { sanitizeError, validateMerchantInput, logAudit, getClientIP, getAllowedColumns, isAllowedColumn } from './security'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(error: string, code: number): Response {
  return new Response(JSON.stringify({ error, code }), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })
}

const MERCHANT_SAFE_COLUMNS = [
  'id', 'name', 'email', 'phone', 'status', 'plan', 'template_id',
  'subdomain', 'theme_color', 'notes', 'created_at', 'expires_at',
]

export async function handleListMerchants(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const statusFilter = url.searchParams.get('status')
    if (statusFilter && !['active', 'frozen', 'expired', 'deleted'].includes(statusFilter)) {
      return errorResponse('状态值无效', 400)
    }
    const allowedCols = MERCHANT_SAFE_COLUMNS.join(', ')
    let sql = `SELECT ${allowedCols} FROM merchants`
    const params: string[] = []
    if (statusFilter) {
      sql += ' WHERE status = ?'
      params.push(statusFilter)
    }
    sql += ' ORDER BY created_at DESC'
    const stmt = env.CENTRAL_DB.prepare(sql)
    const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all()
    return jsonResponse({ merchants: results })
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}

export async function handleGetMerchant(request: Request, env: Env, merchantId: string): Promise<Response> {
  try {
    if (!merchantId || typeof merchantId !== 'string') {
      return errorResponse('商户ID无效', 400)
    }
    const allowedCols = MERCHANT_SAFE_COLUMNS.join(', ')
    const merchant = await env.CENTRAL_DB.prepare(
      `SELECT ${allowedCols} FROM merchants WHERE id = ?`
    ).bind(merchantId).first()
    if (!merchant) return errorResponse('Merchant not found', 404)
    return jsonResponse(merchant)
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}

export async function handleCreateMerchant(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as Record<string, any>
    const { name, email, phone, plan, templateId } = body
    if (!name || !templateId) return errorResponse('name and templateId are required', 400)

    const validation = validateMerchantInput(body)
    if (!validation.valid) {
      return errorResponse(validation.errors.join('; '), 400)
    }

    const id = 'm-' + crypto.randomUUID().slice(0, 8)
    const subdomain = 'shop-' + id
    const createdAt = new Date().toISOString()
    const safeName = name.trim().slice(0, 50)
    const safePlan = ['basic', 'pro', 'enterprise'].includes(plan) ? plan : 'basic'
    await env.CENTRAL_DB.prepare(
      'INSERT INTO merchants (id, name, email, phone, plan, template_id, subdomain, theme_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, safeName, email || null, phone || null, safePlan, templateId, subdomain, '#4F46E5', createdAt).run()
    const allowedCols = MERCHANT_SAFE_COLUMNS.join(', ')
    const merchant = await env.CENTRAL_DB.prepare(`SELECT ${allowedCols} FROM merchants WHERE id = ?`).bind(id).first()
    await logAudit(env, 'MERCHANT_CREATE', 'merchant', id, `Created merchant: ${safeName}`, getClientIP(request))
    return jsonResponse(merchant, 201)
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}

export async function handleUpdateMerchant(request: Request, env: Env, merchantId: string): Promise<Response> {
  try {
    if (!merchantId || typeof merchantId !== 'string') {
      return errorResponse('商户ID无效', 400)
    }
    const existing = await env.CENTRAL_DB.prepare('SELECT id FROM merchants WHERE id = ?').bind(merchantId).first()
    if (!existing) return errorResponse('Merchant not found', 404)
    const body = await request.json() as Record<string, any>

    const validation = validateMerchantInput(body)
    if (!validation.valid) {
      return errorResponse(validation.errors.join('; '), 400)
    }

    const updates: string[] = []
    const values: any[] = []
    for (const key of getAllowedColumns()) {
      if (body[key] !== undefined) {
        if (key === 'name') {
          updates.push(`${key} = ?`)
          values.push(String(body[key]).trim().slice(0, 50))
        } else if (key === 'status' && !['active', 'frozen', 'expired', 'deleted'].includes(body[key])) {
          return errorResponse('状态值无效', 400)
        } else if (key === 'plan' && !['basic', 'pro', 'enterprise'].includes(body[key])) {
          return errorResponse('套餐类型无效', 400)
        } else {
          updates.push(`${key} = ?`)
          values.push(body[key])
        }
      }
    }
    if (updates.length === 0) return errorResponse('No fields to update', 400)
    values.push(merchantId)
    await env.CENTRAL_DB.prepare(`UPDATE merchants SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    const allowedCols = MERCHANT_SAFE_COLUMNS.join(', ')
    const merchant = await env.CENTRAL_DB.prepare(`SELECT ${allowedCols} FROM merchants WHERE id = ?`).bind(merchantId).first()
    await logAudit(env, 'MERCHANT_UPDATE', 'merchant', merchantId,
      `Updated: ${updates.join(', ')}`, getClientIP(request))
    return jsonResponse(merchant)
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}

export async function handleDeleteMerchant(request: Request, env: Env, merchantId: string): Promise<Response> {
  try {
    if (!merchantId || typeof merchantId !== 'string') {
      return errorResponse('商户ID无效', 400)
    }
    const existing = await env.CENTRAL_DB.prepare('SELECT id, name FROM merchants WHERE id = ?').bind(merchantId).first() as { id: string; name: string } | undefined
    if (!existing) return errorResponse('Merchant not found', 404)
    await env.CENTRAL_DB.prepare('UPDATE merchants SET status = ? WHERE id = ?').bind('deleted', merchantId).run()
    await logAudit(env, 'MERCHANT_DELETE', 'merchant', merchantId,
      `Deleted merchant: ${existing.name}`, getClientIP(request))
    return jsonResponse({ success: true })
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}

export async function handleVerifyMerchant(request: Request, env: Env): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Missing or invalid Authorization header', 401)
    }
    const token = authHeader.slice(7)
    const payload = await verifyToken(token, env)
    if (!payload) return errorResponse('Invalid or expired token', 401)
    const merchant = await env.CENTRAL_DB.prepare(
      'SELECT id, status, plan FROM merchants WHERE id = ?'
    ).bind(payload.merchantId).first() as Pick<Merchant, 'id' | 'status' | 'plan'> | null
    if (!merchant) return errorResponse('Merchant not found', 404)
    if (merchant.status === 'deleted') return errorResponse('Merchant deleted', 401)
    return jsonResponse({
      status: merchant.status,
      merchantId: merchant.id,
      plan: merchant.plan,
    })
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}

export async function handleRegenerateToken(request: Request, env: Env, merchantId: string): Promise<Response> {
  try {
    const merchant = await env.CENTRAL_DB.prepare(
      'SELECT id, plan FROM merchants WHERE id = ?'
    ).bind(merchantId).first() as Pick<Merchant, 'id' | 'plan'> | null
    if (!merchant) return errorResponse('Merchant not found', 404)
    const token = await generateToken(merchantId, merchant.plan, env)
    const tokenHash = await hashToken(token)
    await env.CENTRAL_DB.prepare(
      'INSERT INTO merchant_tokens (merchant_id, token_hash, created_at) VALUES (?, ?, ?)'
    ).bind(merchantId, tokenHash, new Date().toISOString()).run()
    await logAudit(env, 'TOKEN_REGENERATE', 'merchant', merchantId,
      'Regenerated merchant token', getClientIP(request))
    return jsonResponse({ token })
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}
