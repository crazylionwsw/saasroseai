import { Env } from './types'
import { jsonResponse, errorResponse } from './utils'

export interface PlanLimits {
  monthlyOrders: number;
  staffSeats: number;
  aiToolCalls: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  basic: { monthlyOrders: 500, staffSeats: 3, aiToolCalls: 2000 },
  pro: { monthlyOrders: 5000, staffSeats: 15, aiToolCalls: 20000 },
  enterprise: { monthlyOrders: -1, staffSeats: -1, aiToolCalls: -1 },
}

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.basic
}

export async function getUsage(env: Env): Promise<{
  plan: string;
  limits: PlanLimits;
  usage: { monthlyOrders: number; monthlyRevenueCents: number; chatSessions: number; aiToolCalls: number; calls: number; staffSeats: number };
}> {
  const firstOfMonth = new Date().toISOString().slice(0, 7) + '-01'

  const planRow = await env.MERCHANT_DB.prepare(
    'SELECT plan FROM merchant_info WHERE id = ?'
  ).bind(env.MERCHANT_ID).first<{ plan: string | null }>()
  const plan = planRow?.plan || 'basic'

  const [orders, revenue, sessions, tools, calls, staff] = await Promise.all([
    env.MERCHANT_DB.prepare(
      `SELECT COUNT(*) as c FROM orders WHERE merchant_id = ? AND created_at >= ?`
    ).bind(env.MERCHANT_ID, firstOfMonth).first<{ c: number }>(),
    env.MERCHANT_DB.prepare(
      `SELECT COALESCE(SUM(total_cents),0) as t FROM orders WHERE merchant_id = ? AND created_at >= ? AND status != 'cancelled'`
    ).bind(env.MERCHANT_ID, firstOfMonth).first<{ t: number }>(),
    env.MERCHANT_DB.prepare(
      `SELECT COUNT(*) as c FROM chat_sessions WHERE merchant_id = ? AND started_at >= ?`
    ).bind(env.MERCHANT_ID, firstOfMonth).first<{ c: number }>(),
    env.MERCHANT_DB.prepare(
      `SELECT COUNT(*) as c FROM analytics_events WHERE merchant_id = ? AND event_type = 'ai_tool' AND created_at >= ?`
    ).bind(env.MERCHANT_ID, firstOfMonth).first<{ c: number }>(),
    env.MERCHANT_DB.prepare(
      `SELECT COUNT(*) as c FROM call_records WHERE merchant_id = ? AND created_at >= ?`
    ).bind(env.MERCHANT_ID, firstOfMonth).first<{ c: number }>(),
    env.MERCHANT_DB.prepare(
      `SELECT COUNT(*) as c FROM staff_users WHERE merchant_id = ? AND is_active = 1`
    ).bind(env.MERCHANT_ID).first<{ c: number }>(),
  ])

  return {
    plan,
    limits: getPlanLimits(plan),
    usage: {
      monthlyOrders: orders?.c || 0,
      monthlyRevenueCents: revenue?.t || 0,
      chatSessions: sessions?.c || 0,
      aiToolCalls: tools?.c || 0,
      calls: calls?.c || 0,
      staffSeats: staff?.c || 0,
    },
  }
}

export async function handleGetUsage(_request: Request, env: Env): Promise<Response> {
  try {
    const data = await getUsage(env)
    return jsonResponse(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`获取用量失败: ${msg}`, 500, 500)
  }
}

export async function enforceOrderQuota(env: Env): Promise<{ allowed: boolean; message?: string }> {
  try {
    const { limits, usage } = await getUsage(env)
    if (limits.monthlyOrders >= 0 && usage.monthlyOrders >= limits.monthlyOrders) {
      return { allowed: false, message: `本月订单已达套餐上限 (${limits.monthlyOrders})，请升级套餐` }
    }
    return { allowed: true }
  } catch {
    return { allowed: true }
  }
}
