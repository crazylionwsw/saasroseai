import { Env } from './types'
import { jsonResponse, errorResponse, generateId } from './utils'
import { getTaxRateBp } from './pricing'

const VALID_CODES = ['GST', 'PST', 'HST', 'QST']

export async function handleGetTaxRules(_request: Request, env: Env): Promise<Response> {
  try {
    const rules = await env.MERCHANT_DB.prepare(
      `SELECT id, tax_code, rate_bp, is_active FROM tax_rules WHERE merchant_id = ? ORDER BY created_at ASC`
    ).bind(env.MERCHANT_ID).all<{ id: string; tax_code: string; rate_bp: number; is_active: number }>()
    return jsonResponse({
      rules: rules.results || [],
      effectiveRateBp: await getTaxRateBp(env),
    })
  } catch {
    return errorResponse('获取税规则失败', 500, 500)
  }
}

export async function handleUpdateTaxRules(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ rules: { taxCode: string; rateBp: number }[] }>()
    const rules = Array.isArray(body.rules) ? body.rules : []

    for (const rule of rules) {
      const code = String(rule.taxCode || '').toUpperCase()
      const bp = Math.floor(Number(rule.rateBp))
      if (!VALID_CODES.includes(code)) {
        return errorResponse(`无效税种: ${code}`, 400)
      }
      if (!Number.isFinite(bp) || bp < 0 || bp > 20000) {
        return errorResponse(`无效税率: ${bp}`, 400)
      }
    }

    const now = new Date().toISOString()
    await env.MERCHANT_DB.prepare(
      `DELETE FROM tax_rules WHERE merchant_id = ?`
    ).bind(env.MERCHANT_ID).run()

    const stmts = rules.map((rule) =>
      env.MERCHANT_DB.prepare(
        `INSERT INTO tax_rules (id, merchant_id, tax_code, rate_bp, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)`
      ).bind(generateId('tax_'), env.MERCHANT_ID, String(rule.taxCode).toUpperCase(), Math.floor(Number(rule.rateBp)), now)
    )
    if (stmts.length > 0) {
      await env.MERCHANT_DB.batch(stmts)
    }

    return jsonResponse({
      rules,
      effectiveRateBp: await getTaxRateBp(env),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`更新税规则失败: ${msg}`, 400)
  }
}
