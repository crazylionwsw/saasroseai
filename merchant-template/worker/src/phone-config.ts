import { Env } from './types'
import { jsonResponse, errorResponse } from './utils'

export async function handlePhoneStatus(request: Request, env: Env): Promise<Response> {
  try {
    const merchant = await env.MERCHANT_DB.prepare(
      'SELECT enable_phone, phone AS business_phone, language FROM merchant_info WHERE id = ?'
    ).bind(env.MERCHANT_ID).first() as { enable_phone: number; business_phone: string; language: string } | null

    return jsonResponse({
      enabled: merchant ? merchant.enable_phone === 1 : false,
      businessPhone: merchant?.business_phone || '',
      language: merchant?.language || 'zh',
      twilioPhone: env.TWILIO_PHONE_NUMBER || '',
    })
  } catch {
    return errorResponse('获取电话状态失败', 500, 500)
  }
}

export async function handlePhoneConfigure(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const { enabled, businessPhone, language } = body

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return errorResponse('enabled 必须是布尔值', 400)
    }
    if (language && !['zh', 'en', 'fr'].includes(language)) {
      return errorResponse('不支持的语言，仅支持 zh/en/fr', 400)
    }

    const updates: string[] = []
    const binds: any[] = []
    if (enabled !== undefined) {
      updates.push('enable_phone = ?')
      binds.push(enabled ? 1 : 0)
    }
    if (businessPhone !== undefined) {
      updates.push('phone = ?')
      binds.push(businessPhone)
    }
    if (language !== undefined) {
      updates.push('language = ?')
      binds.push(language)
    }

    if (updates.length === 0) {
      return errorResponse('无更新字段', 400)
    }

    binds.push(env.MERCHANT_ID)
    await env.MERCHANT_DB.prepare(
      `UPDATE merchant_info SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run()

    return jsonResponse({ success: true })
  } catch {
    return errorResponse('配置失败', 500, 500)
  }
}
