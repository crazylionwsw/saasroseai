import { Env } from './types'
import { jsonResponse, errorResponse } from './utils'

export async function handleDashboardStats(request: Request, env: Env): Promise<Response> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const firstOfMonth = new Date().toISOString().slice(0, 7) + '-01'

    const [totalOrders, todayOrders, monthlyOrders, revenue, todayRevenue, monthlyRevenue, pendingOrders] = await Promise.all([
      env.MERCHANT_DB.prepare('SELECT COUNT(*) as c FROM orders WHERE merchant_id = ?').bind(env.MERCHANT_ID).first<{ c: number }>(),
      env.MERCHANT_DB.prepare("SELECT COUNT(*) as c FROM orders WHERE merchant_id = ? AND date(created_at) = ?").bind(env.MERCHANT_ID, today).first<{ c: number }>(),
      env.MERCHANT_DB.prepare("SELECT COUNT(*) as c FROM orders WHERE merchant_id = ? AND created_at >= ?").bind(env.MERCHANT_ID, firstOfMonth).first<{ c: number }>(),
      env.MERCHANT_DB.prepare("SELECT COALESCE(SUM(total),0) as t FROM orders WHERE merchant_id = ? AND status != 'cancelled'").bind(env.MERCHANT_ID).first<{ t: number }>(),
      env.MERCHANT_DB.prepare("SELECT COALESCE(SUM(total),0) as t FROM orders WHERE merchant_id = ? AND date(created_at) = ? AND status != 'cancelled'").bind(env.MERCHANT_ID, today).first<{ t: number }>(),
      env.MERCHANT_DB.prepare("SELECT COALESCE(SUM(total),0) as t FROM orders WHERE merchant_id = ? AND created_at >= ? AND status != 'cancelled'").bind(env.MERCHANT_ID, firstOfMonth).first<{ t: number }>(),
      env.MERCHANT_DB.prepare("SELECT COUNT(*) as c FROM orders WHERE merchant_id = ? AND status = 'pending'").bind(env.MERCHANT_ID).first<{ c: number }>(),
    ])

    return jsonResponse({
      totalOrders: totalOrders?.c || 0,
      todayOrders: todayOrders?.c || 0,
      monthlyOrders: monthlyOrders?.c || 0,
      totalRevenue: revenue?.t || 0,
      todayRevenue: todayRevenue?.t || 0,
      monthlyRevenue: monthlyRevenue?.t || 0,
      pendingOrders: pendingOrders?.c || 0,
    })
  } catch {
    return errorResponse('获取统计数据失败', 500, 500)
  }
}

export async function handleSalesReport(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const period = url.searchParams.get('period') || 'daily'
    const days = parseInt(url.searchParams.get('days') || '7')

    let dateFormat: string
    let whereClause: string
    if (period === 'daily') {
      dateFormat = '%Y-%m-%d'
      whereClause = `datetime('now', '-${days} days')`
    } else if (period === 'weekly') {
      dateFormat = '%Y-%W'
      whereClause = `datetime('now', '-${days * 7} days')`
    } else if (period === 'monthly') {
      dateFormat = '%Y-%m'
      whereClause = `datetime('now', '-${days * 30} days')`
    } else if (period === 'hourly') {
      dateFormat = '%Y-%m-%d %H:00'
      whereClause = `datetime('now', '-${Math.min(days, 3)} days')`
    } else {
      return errorResponse('无效的统计周期，可选: daily/weekly/monthly/hourly', 400)
    }

    const rows = await env.MERCHANT_DB.prepare(
      `SELECT strftime('${dateFormat}', created_at) as period,
              COUNT(*) as order_count,
              COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) as revenue,
              COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total ELSE NULL END), 0) as avg_order
       FROM orders
       WHERE merchant_id = ? AND created_at >= ${whereClause}
       GROUP BY period ORDER BY period ASC`
    ).bind(env.MERCHANT_ID).all()

    return jsonResponse({
      period,
      days: period === 'hourly' ? Math.min(days, 3) : days,
      data: rows.results || [],
    })
  } catch {
    return errorResponse('获取报表失败', 500, 500)
  }
}

export async function handleTopItems(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '10')
    const days = parseInt(url.searchParams.get('days') || '30')

    const rows = await env.MERCHANT_DB.prepare(
      `SELECT oi.value as item_name, SUM(oi.quantity) as qty, SUM(oi.total) as revenue
       FROM orders, json_each(orders.items) as oi
       WHERE orders.merchant_id = ? AND orders.status != 'cancelled'
         AND orders.created_at >= datetime('now', '-${days} days')
       GROUP BY item_name ORDER BY qty DESC LIMIT ?`
    ).bind(env.MERCHANT_ID, limit).all()

    return jsonResponse({ items: rows.results || [], limit, days })
  } catch {
    return jsonResponse({ items: [], limit: 0, days: 0 })
  }
}

export async function handleOrderStatusBreakdown(request: Request, env: Env): Promise<Response> {
  try {
    const rows = await env.MERCHANT_DB.prepare(
      `SELECT status, COUNT(*) as count FROM orders
       WHERE merchant_id = ? GROUP BY status`
    ).bind(env.MERCHANT_ID).all()

    return jsonResponse({ breakdown: rows.results || [] })
  } catch {
    return jsonResponse({ breakdown: [] })
  }
}
