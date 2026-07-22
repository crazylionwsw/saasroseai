import { Env } from './types'
import { jsonResponse, errorResponse, generateId } from './utils'

export async function handleListDeliveries(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const platform = url.searchParams.get('platform')
    let query = 'SELECT * FROM delivery_orders WHERE merchant_id = ?'
    const params: any[] = [env.MERCHANT_ID]
    if (platform) { query += ' AND platform = ?'; params.push(platform) }
    query += ' ORDER BY created_at DESC LIMIT 50'
    const orders = await env.MERCHANT_DB.prepare(query).bind(...params).all()
    return jsonResponse({ orders: orders.results || [] })
  } catch {
    return jsonResponse({ orders: [] })
  }
}

export async function handleExportDelivery(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const format = url.searchParams.get('format') || 'doorDash'
    const status = url.searchParams.get('status') || 'pending'
    const days = parseInt(url.searchParams.get('days') || '1')

    const orders = await env.MERCHANT_DB.prepare(
      `SELECT * FROM orders WHERE merchant_id = ? AND status = ? AND created_at >= datetime('now', '-${days} days') ORDER BY created_at DESC`
    ).bind(env.MERCHANT_ID, status).all()

    if (format === 'csv') {
      let csv = 'OrderID,CustomerName,Phone,Address,Items,Total,Status,Created\n'
      for (const o of (orders.results || []) as any[]) {
        const items = typeof o.items === 'string' ? o.items.replace(/"/g, '""') : JSON.stringify(o.items || [])
        csv += `"${o.id}","${o.customer_name || ''}","${o.customer_phone || ''}","${o.customer_address || ''}","${items}",${o.total || 0},"${o.status}","${o.created_at}"\n`
      }
      return new Response(csv, {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=orders-export.csv' },
      })
    }

    return jsonResponse({ orders: orders.results || [] })
  } catch {
    return errorResponse('导出失败', 500, 500)
  }
}

export async function handleListInventory(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const storeId = url.searchParams.get('storeId')
    const lowStock = url.searchParams.get('lowStock') === 'true'
    let query = 'SELECT * FROM inventory_items WHERE merchant_id = ?'
    const params: any[] = [env.MERCHANT_ID]
    if (storeId) { query += ' AND store_id = ?'; params.push(storeId) }
    if (lowStock) { query += ' AND stock <= min_stock' }
    query += ' ORDER BY name ASC'
    const items = await env.MERCHANT_DB.prepare(query).bind(...params).all()
    return jsonResponse({ items: items.results || [] })
  } catch {
    return jsonResponse({ items: [] })
  }
}

export async function handleUpdateInventory(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const { id, name, category, unit, stock, minStock, costPrice, supplierId, storeId } = body
    if (id) {
      const updates: string[] = ['updated_at = datetime(\'now\')']
      const values: any[] = []
      if (name !== undefined) { updates.push('name = ?'); values.push(name) }
      if (category !== undefined) { updates.push('category = ?'); values.push(category) }
      if (unit !== undefined) { updates.push('unit = ?'); values.push(unit) }
      if (stock !== undefined) { updates.push('stock = ?'); values.push(stock) }
      if (minStock !== undefined) { updates.push('min_stock = ?'); values.push(minStock) }
      if (costPrice !== undefined) { updates.push('cost_price = ?'); values.push(costPrice) }
      if (supplierId !== undefined) { updates.push('supplier_id = ?'); values.push(supplierId) }
      if (storeId !== undefined) { updates.push('store_id = ?'); values.push(storeId) }
      if (values.length === 0) return errorResponse('无更新字段', 400)
      values.push(id, env.MERCHANT_ID)
      await env.MERCHANT_DB.prepare(`UPDATE inventory_items SET ${updates.join(', ')} WHERE id = ? AND merchant_id = ?`).bind(...values).run()
    } else {
      if (!name) return errorResponse('名称必填', 400)
      const itemId = generateId('inv_')
      await env.MERCHANT_DB.prepare(
        'INSERT INTO inventory_items (id, merchant_id, store_id, name, category, unit, stock, min_stock, cost_price, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(itemId, env.MERCHANT_ID, storeId || null, name, category || null, unit || '个', stock ?? 0, minStock ?? 0, costPrice ?? 0, supplierId || null).run()
    }
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('更新库存失败', 500, 500)
  }
}

export async function handleDeleteInventory(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const itemId = url.searchParams.get('id')
    if (!itemId) return errorResponse('缺少库存项ID', 400)
    await env.MERCHANT_DB.prepare('DELETE FROM inventory_items WHERE id = ? AND merchant_id = ?').bind(itemId, env.MERCHANT_ID).run()
    return jsonResponse({ success: true })
  } catch {
    return errorResponse('删除失败', 500, 500)
  }
}

export async function handleListSuppliers(request: Request, env: Env): Promise<Response> {
  try {
    const suppliers = await env.MERCHANT_DB.prepare('SELECT * FROM suppliers WHERE merchant_id = ? ORDER BY name ASC').bind(env.MERCHANT_ID).all()
    return jsonResponse({ suppliers: suppliers.results || [] })
  } catch {
    return jsonResponse({ suppliers: [] })
  }
}

export async function handleCreateSupplier(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<any>()
    const { name, contactName, contactPhone, email, address, notes } = body
    if (!name) return errorResponse('供应商名称必填', 400)
    const id = generateId('sup_')
    await env.MERCHANT_DB.prepare(
      'INSERT INTO suppliers (id, merchant_id, name, contact_name, contact_phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, env.MERCHANT_ID, name, contactName || null, contactPhone || null, email || null, address || null, notes || null).run()
    return jsonResponse({ id, name }, 201)
  } catch {
    return errorResponse('创建供应商失败', 500, 500)
  }
}
