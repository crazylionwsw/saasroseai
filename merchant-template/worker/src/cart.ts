import { Env, CartLineRequest } from './types'
import { jsonResponse, errorResponse, generateId } from './utils'
import { calculateLines, loadMenu, findMenuItem, calculateQuote } from './pricing'

interface CartItemRow {
  id: string;
  cart_id: string;
  merchant_id: string;
  item_id: string;
  qty: number;
  modifiers: string | null;
}

export interface CartLine {
  lineId: string;
  itemId: string;
  name: string;
  qty: number;
  modifiers: string[];
  unitCents: number;
  lineCents: number;
}

function parseModifiers(raw: string | null): string[] {
  try {
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export async function createCart(env: Env): Promise<string> {
  const cartId = generateId('cart_')
  const now = new Date().toISOString()
  await env.MERCHANT_DB.prepare(
    `INSERT INTO carts (id, merchant_id, status, created_at, updated_at) VALUES (?, ?, 'open', ?, ?)`
  ).bind(cartId, env.MERCHANT_ID, now, now).run()
  return cartId
}

async function getCartItems(env: Env, cartId: string): Promise<CartItemRow[]> {
  const rows = await env.MERCHANT_DB.prepare(
    `SELECT * FROM cart_items WHERE cart_id = ? AND merchant_id = ? ORDER BY created_at ASC`
  ).bind(cartId, env.MERCHANT_ID).all<CartItemRow>()
  return rows.results || []
}

export async function getCart(env: Env, cartId: string): Promise<{ id: string; lines: CartLine[] } | null> {
  const cart = await env.MERCHANT_DB.prepare(
    `SELECT id, status FROM carts WHERE id = ? AND merchant_id = ?`
  ).bind(cartId, env.MERCHANT_ID).first<{ id: string; status: string } | null>()
  if (!cart) return null

  const rows = await getCartItems(env, cartId)
  const menuItems = await loadMenu(env)
  const lines: CartLine[] = rows.map((row) => {
    const menuItem = findMenuItem(menuItems, row.item_id)
    const unitCents = menuItem ? Math.round(menuItem.price * 100) : 0
    const qty = Math.max(1, Number(row.qty) || 1)
    return {
      lineId: row.id,
      itemId: row.item_id,
      name: menuItem?.name || row.item_id,
      qty,
      modifiers: parseModifiers(row.modifiers),
      unitCents,
      lineCents: unitCents * qty,
    }
  })
  return { id: cart.id, lines }
}

export async function addItemToCart(
  env: Env,
  cartId: string,
  line: CartLineRequest
): Promise<CartLine> {
  const menuItems = await loadMenu(env)
  const { lines, errors } = calculateLines([line], menuItems)
  if (errors.length > 0) throw new Error(errors.join('；'))
  const calculated = lines[0]
  const modifiers = JSON.stringify(line.modifiers || [])

  // Upsert: same item + modifiers => increment qty
  const existing = await env.MERCHANT_DB.prepare(
    `SELECT id, qty FROM cart_items WHERE cart_id = ? AND merchant_id = ? AND item_id = ? AND modifiers = ? LIMIT 1`
  ).bind(cartId, env.MERCHANT_ID, calculated.id, modifiers).first<{ id: string; qty: number } | null>()
  if (existing) {
    await env.MERCHANT_DB.prepare(
      `UPDATE cart_items SET qty = ? WHERE id = ? AND cart_id = ?`
    ).bind(existing.qty + calculated.qty, existing.id, cartId).run()
    return { lineId: existing.id, itemId: calculated.id, name: calculated.name, qty: existing.qty + calculated.qty, modifiers: line.modifiers || [], unitCents: calculated.priceCents, lineCents: calculated.priceCents * (existing.qty + calculated.qty) }
  }

  const lineId = generateId('cl_')
  await env.MERCHANT_DB.prepare(
    `INSERT INTO cart_items (id, cart_id, merchant_id, item_id, qty, modifiers) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(lineId, cartId, env.MERCHANT_ID, calculated.id, calculated.qty, modifiers).run()
  return { lineId, itemId: calculated.id, name: calculated.name, qty: calculated.qty, modifiers: line.modifiers || [], unitCents: calculated.priceCents, lineCents: calculated.lineCents }
}

export async function updateCartItemQty(env: Env, cartId: string, lineId: string, qty: number): Promise<boolean> {
  const result = await env.MERCHANT_DB.prepare(
    `UPDATE cart_items SET qty = ? WHERE id = ? AND cart_id = ? AND merchant_id = ?`
  ).bind(qty, lineId, cartId, env.MERCHANT_ID).run()
  return result.meta.changes > 0
}

export async function removeCartItem(env: Env, cartId: string, lineId: string): Promise<boolean> {
  const result = await env.MERCHANT_DB.prepare(
    `DELETE FROM cart_items WHERE id = ? AND cart_id = ? AND merchant_id = ?`
  ).bind(lineId, cartId, env.MERCHANT_ID).run()
  return result.meta.changes > 0
}

export async function clearCart(env: Env, cartId: string): Promise<void> {
  await env.MERCHANT_DB.prepare(
    `DELETE FROM cart_items WHERE cart_id = ? AND merchant_id = ?`
  ).bind(cartId, env.MERCHANT_ID).run()
}

export async function calculateCartQuote(env: Env, cartId: string, tipPercent?: number) {
  const rows = await getCartItems(env, cartId)
  const requested: CartLineRequest[] = rows.map((row) => ({
    id: row.item_id,
    qty: row.qty,
    modifiers: parseModifiers(row.modifiers),
  }))
  return calculateQuote(env, requested, tipPercent)
}

// --- HTTP handlers ---

export async function handleCreateCart(_request: Request, env: Env): Promise<Response> {
  try {
    const cartId = await createCart(env)
    return jsonResponse({ cartId }, 201)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`创建购物车失败: ${msg}`, 500)
  }
}

export async function handleGetCart(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const cartId = (request as any).params?.cartId || url.searchParams.get('cartId')
    if (!cartId) return errorResponse('缺少 cartId', 400)
    const cart = await getCart(env, cartId)
    if (!cart) return errorResponse('购物车不存在', 404)
    return jsonResponse(cart)
  } catch {
    return errorResponse('获取购物车失败', 500, 500)
  }
}

export async function handleAddCartItem(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ cartId: string; itemId: string | number; qty: number; modifiers?: string[] }>()
    if (!body.cartId || body.itemId === undefined || !body.qty) {
      return errorResponse('缺少必填字段 (cartId, itemId, qty)', 400)
    }
    const cart = await getCart(env, body.cartId)
    if (!cart) return errorResponse('购物车不存在', 404)
    const line = await addItemToCart(env, body.cartId, { id: body.itemId, qty: body.qty, modifiers: body.modifiers })
    return jsonResponse({ lineId: line.lineId, itemId: line.itemId, name: line.name, qty: line.qty }, 201)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`添加菜品失败: ${msg}`, 400)
  }
}

export async function handleUpdateCartItem(request: Request, env: Env): Promise<Response> {
  try {
    const lineId = (request as any).params?.lineId
    const body = await request.json<{ cartId: string; qty: number }>()
    const qty = Math.floor(Number(body.qty))
    if (!lineId || !body.cartId || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return errorResponse('无效的数量', 400)
    }
    const ok = await updateCartItemQty(env, body.cartId, lineId, qty)
    if (!ok) return errorResponse('购物车行不存在', 404)
    return jsonResponse({ lineId, qty })
  } catch {
    return errorResponse('更新购物车失败', 500, 500)
  }
}

export async function handleRemoveCartItem(request: Request, env: Env): Promise<Response> {
  try {
    const lineId = (request as any).params?.lineId
    const url = new URL(request.url)
    const cartId = url.searchParams.get('cartId')
    if (!lineId || !cartId) return errorResponse('缺少参数', 400)
    const ok = await removeCartItem(env, cartId, lineId)
    if (!ok) return errorResponse('购物车行不存在', 404)
    return jsonResponse({ removed: true })
  } catch {
    return errorResponse('删除购物车项失败', 500, 500)
  }
}

export async function handleCalculateCart(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ cartId?: string; items?: CartLineRequest[]; tipPercent?: number }>()
    let quote
    if (body.cartId) {
      const cart = await getCart(env, body.cartId)
      if (!cart) return errorResponse('购物车不存在', 404)
      quote = await calculateCartQuote(env, body.cartId, body.tipPercent)
    } else if (Array.isArray(body.items) && body.items.length > 0) {
      quote = await calculateQuote(env, body.items, body.tipPercent)
    } else {
      return errorResponse('缺少 cartId 或 items', 400)
    }
    return jsonResponse(quote)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return errorResponse(`价格计算失败: ${msg}`, 400)
  }
}
