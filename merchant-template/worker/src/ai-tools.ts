import { Env } from './types'
import { loadMenu, findMenuItem, priceToCents } from './pricing'
import { createCart, getCart, addItemToCart, updateCartItemQty, removeCartItem, calculateCartQuote } from './cart'
import { placeOrder } from './order'
import { createPaymentForOrder, getPaymentStatus } from './payment'
import { canTransitionOrder } from './order-state'

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  required?: boolean;
  description?: string;
}

export interface ToolResult {
  tool: string;
  ok: boolean;
  data: any;
  error?: string;
}

export type ToolHandler = (args: Record<string, any>, env: Env) => Promise<any>

export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParameter[];
  handler: ToolHandler;
}

function coerceParam(value: any, param: ToolParameter): { value?: any; error?: string } {
  if (value === undefined || value === null || value === '') {
    if (param.required) return { error: `缺少参数: ${param.name}` }
    return { value: undefined }
  }
  switch (param.type) {
    case 'string':
      return { value: String(value) }
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) return { error: `参数 ${param.name} 必须是数字` }
      return { value: n }
    }
    case 'boolean':
      return { value: value === true || value === 'true' || value === 1 || value === '1' }
    case 'array':
      return { value: Array.isArray(value) ? value : [value] }
    default:
      return { value }
  }
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>()

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }

  list(): ToolDef[] {
    return Array.from(this.tools.values())
  }
}

export function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry()

  registry.register({
    name: 'search_menu',
    description: '搜索餐厅菜单中的菜品',
    parameters: [
      { name: 'query', type: 'string', required: true, description: '搜索关键词（菜名或类别）' },
    ],
    handler: async (args, env) => {
      const query = String(args.query || '').toLowerCase()
      const menu = await loadMenu(env)
      const matches = menu.filter((item) => {
        const haystack = `${item.name} ${item.category} ${item.tags?.join(' ')} ${item.description}`.toLowerCase()
        return !query || haystack.includes(query)
      })
      return matches.slice(0, 20).map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        priceCents: priceToCents(item.price),
        category: item.category,
        isAvailable: item.isAvailable !== false,
      }))
    },
  })

  registry.register({
    name: 'get_menu_item',
    description: '根据 ID 获取单个菜品信息',
    parameters: [{ name: 'itemId', type: 'string', required: true }],
    handler: async (args, env) => {
      const menu = await loadMenu(env)
      const item = findMenuItem(menu, args.itemId)
      if (!item) throw new Error(`菜品不存在: ${args.itemId}`)
      return { id: item.id, name: item.name, description: item.description, priceCents: priceToCents(item.price), category: item.category, isAvailable: item.isAvailable !== false }
    },
  })

  registry.register({
    name: 'create_cart',
    description: '创建购物车',
    parameters: [],
    handler: async (_args, env) => ({ cartId: await createCart(env) }),
  })

  registry.register({
    name: 'add_item',
    description: '向购物车添加菜品',
    parameters: [
      { name: 'cartId', type: 'string', required: true },
      { name: 'itemId', type: 'string', required: true },
      { name: 'qty', type: 'number', required: true },
      { name: 'modifiers', type: 'array' },
    ],
    handler: async (args, env) => {
      const cart = await getCart(env, args.cartId)
      if (!cart) throw new Error('购物车不存在')
      return addItemToCart(env, args.cartId, { id: args.itemId, qty: args.qty, modifiers: args.modifiers || [] })
    },
  })

  registry.register({
    name: 'update_quantity',
    description: '更新购物车中某行的数量',
    parameters: [
      { name: 'cartId', type: 'string', required: true },
      { name: 'lineId', type: 'string', required: true },
      { name: 'qty', type: 'number', required: true },
    ],
    handler: async (args, env) => {
      const ok = await updateCartItemQty(env, args.cartId, args.lineId, Math.max(1, Math.floor(args.qty)))
      if (!ok) throw new Error('购物车行不存在')
      return { lineId: args.lineId, qty: Math.max(1, Math.floor(args.qty)) }
    },
  })

  registry.register({
    name: 'remove_item',
    description: '从购物车移除某行',
    parameters: [
      { name: 'cartId', type: 'string', required: true },
      { name: 'lineId', type: 'string', required: true },
    ],
    handler: async (args, env) => {
      const ok = await removeCartItem(env, args.cartId, args.lineId)
      if (!ok) throw new Error('购物车行不存在')
      return { removed: true }
    },
  })

  registry.register({
    name: 'calculate_cart',
    description: '计算购物车总额（服务端计价，含税）',
    parameters: [
      { name: 'cartId', type: 'string', required: true },
      { name: 'tipPercent', type: 'number' },
    ],
    handler: async (args, env) => calculateCartQuote(env, args.cartId, args.tipPercent),
  })

  registry.register({
    name: 'create_order',
    description: '根据购物车创建订单（服务端计价）',
    parameters: [
      { name: 'cartId', type: 'string', required: true },
      { name: 'orderType', type: 'string' },
      { name: 'customerName', type: 'string' },
      { name: 'customerPhone', type: 'string' },
      { name: 'customerAddress', type: 'string' },
      { name: 'note', type: 'string' },
      { name: 'tipPercent', type: 'number' },
    ],
    handler: async (args, env) => {
      const cart = await getCart(env, args.cartId)
      if (!cart) throw new Error('购物车不存在')
      if (cart.lines.length === 0) throw new Error('购物车为空')
      const items = cart.lines.map((line) => ({ id: line.itemId, qty: line.qty, modifiers: line.modifiers }))
      const orderType = args.orderType === 'dine_in' ? 'dine_in' : 'pickup'
      const { payload } = await placeOrder(env, {
        orderType,
        items,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        customerAddress: args.customerAddress,
        note: args.note,
        tipPercent: args.tipPercent,
      })
      return payload
    },
  })

  registry.register({
    name: 'get_order_status',
    description: '查询订单状态',
    parameters: [{ name: 'orderId', type: 'string', required: true }],
    handler: async (args, env) => {
      const row = await env.MERCHANT_DB.prepare(
        'SELECT id, status, payment_status, total_cents, created_at FROM orders WHERE id = ? AND merchant_id = ?'
      ).bind(args.orderId, env.MERCHANT_ID).first<any | null>()
      if (!row) throw new Error('订单不存在')
      return { orderId: row.id, status: row.status, paymentStatus: row.payment_status, totalCents: row.total_cents, createdAt: row.created_at }
    },
  })

  registry.register({
    name: 'cancel_order',
    description: '取消订单',
    parameters: [{ name: 'orderId', type: 'string', required: true }],
    handler: async (args, env) => {
      const row = await env.MERCHANT_DB.prepare(
        'SELECT status FROM orders WHERE id = ? AND merchant_id = ?'
      ).bind(args.orderId, env.MERCHANT_ID).first<{ status: string } | null>()
      if (!row) throw new Error('订单不存在')
      if (!canTransitionOrder(row.status as any, 'cancelled')) {
        throw new Error(`订单当前状态 ${row.status} 无法取消`)
      }
      await env.MERCHANT_DB.prepare(
        `UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND merchant_id = ?`
      ).bind(args.orderId, env.MERCHANT_ID).run()
      return { orderId: args.orderId, status: 'cancelled' }
    },
  })

  registry.register({
    name: 'create_payment',
    description: '为订单创建 Stripe 支付，返回支付链接',
    parameters: [
      { name: 'orderId', type: 'string', required: true },
      { name: 'origin', type: 'string' },
    ],
    handler: async (args, env) => {
      const origin = args.origin || `https://${env.MERCHANT_ID}.pages.dev`
      const payment = await createPaymentForOrder(env, args.orderId, origin)
      return { paymentId: payment.paymentId, checkoutUrl: payment.checkoutUrl, amountCents: payment.amountCents }
    },
  })

  registry.register({
    name: 'get_payment_status',
    description: '查询订单支付状态',
    parameters: [{ name: 'orderId', type: 'string', required: true }],
    handler: async (args, env) => getPaymentStatus(env, args.orderId),
  })

  return registry
}

export async function executeTool(
  name: string,
  rawArgs: Record<string, any>,
  env: Env
): Promise<ToolResult> {
  const registry = buildRegistry()
  const tool = registry.get(name)
  if (!tool) {
    return { tool: name, ok: false, data: null, error: `未知工具: ${name}` }
  }

  const args: Record<string, any> = {}
  for (const param of tool.parameters) {
    const coerced = coerceParam(rawArgs[param.name], param)
    if (coerced.error) {
      return { tool: name, ok: false, data: null, error: coerced.error }
    }
    if (coerced.value !== undefined) args[param.name] = coerced.value
  }

  try {
    const data = await tool.handler(args, env)
    try {
      await env.MERCHANT_DB.prepare(
        `INSERT INTO analytics_events (merchant_id, event_type, event_data) VALUES (?, 'ai_tool', ?)`
      ).bind(env.MERCHANT_ID, JSON.stringify({ tool: name, args })).run()
    } catch {}
    return { tool: name, ok: true, data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { tool: name, ok: false, data: null, error: msg }
  }
}

export const TOOL_DEFINITIONS = buildRegistry().list()
