import { Env, MenuItem, CalculatedLine, PriceQuote, CartLineRequest } from './types'

export const DEFAULT_CURRENCY = 'CAD'
export const MAX_QTY = 99

export function priceToCents(price: number): number {
  if (!Number.isFinite(price) || price < 0) return 0
  return Math.round(price * 100)
}

function normalizeMenu(raw: any[]): MenuItem[] {
  const items: MenuItem[] = []
  for (const cat of raw || []) {
    const categoryName = cat?.name || 'Menu'
    for (const item of cat?.items || []) {
      items.push({ ...item, id: String(item.id), category: categoryName })
    }
  }
  return items
}

export async function loadMenu(env: Env): Promise<MenuItem[]> {
  const row = await env.MERCHANT_DB.prepare(
    'SELECT menu_categories FROM merchant_info WHERE id = ?'
  ).bind(env.MERCHANT_ID).first<{ menu_categories: string | null }>()
  if (!row?.menu_categories) return []
  try {
    const parsed = JSON.parse(row.menu_categories)
    return normalizeMenu(Array.isArray(parsed) ? parsed : parsed.categories)
  } catch {
    return []
  }
}

export function findMenuItem(items: MenuItem[], id: string | number): MenuItem | null {
  const needle = String(id)
  for (const item of items) {
    if (item.id === needle) return item
  }
  return null
}

export function calculateLines(
  requested: CartLineRequest[],
  menuItems: MenuItem[]
): { lines: CalculatedLine[]; errors: string[] } {
  const lines: CalculatedLine[] = []
  const errors: string[] = []

  for (const line of requested) {
    const qty = Math.floor(Number(line.qty))
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      errors.push(`无效数量: ${line.id}`)
      continue
    }
    const item = findMenuItem(menuItems, line.id)
    if (!item) {
      errors.push(`菜品不存在: ${line.id}`)
      continue
    }
    if (item.isAvailable === false) {
      errors.push(`菜品已下架: ${item.name}`)
      continue
    }
    const baseCents = priceToCents(item.price)
    let modifierCents = 0
    for (const optLabel of line.modifiers || []) {
      const spec = item.specifications?.find((s) => s.options.some((o) => o.label === optLabel))
      if (spec) {
        const opt = spec.options.find((o) => o.label === optLabel)
        if (opt) modifierCents += priceToCents(opt.priceDelta)
      } else {
        errors.push(`无效规格: ${optLabel} (${item.name})`)
      }
    }
    const unitCents = baseCents + modifierCents
    lines.push({
      id: item.id,
      name: item.name,
      qty,
      priceCents: unitCents,
      lineCents: unitCents * qty,
    })
  }

  return { lines, errors }
}

export async function getTaxRateBp(env: Env): Promise<number> {
  try {
    const rules = await env.MERCHANT_DB.prepare(
      `SELECT tax_code, rate_bp FROM tax_rules WHERE merchant_id = ? AND is_active = 1`
    ).bind(env.MERCHANT_ID).all<{ tax_code: string; rate_bp: number }>()
    if (rules.results && rules.results.length > 0) {
      const total = rules.results.reduce((sum, r) => sum + (Number(r.rate_bp) || 0), 0)
      if (total >= 0) return total
    }
  } catch {}
  // Fallback: single configurable rate on merchant_info (basis points, default 5.00%)
  try {
    const row = await env.MERCHANT_DB.prepare(
      'SELECT tax_rate FROM merchant_info WHERE id = ?'
    ).bind(env.MERCHANT_ID).first<{ tax_rate: number | null }>()
    const bp = Number(row?.tax_rate ?? 500)
    return Number.isFinite(bp) && bp >= 0 ? Math.floor(bp) : 500
  } catch {
    return 500
  }
}

export async function calculateQuote(
  env: Env,
  requested: CartLineRequest[],
  tipPercent?: number
): Promise<PriceQuote> {
  const menuItems = await loadMenu(env)
  const { lines, errors } = calculateLines(requested, menuItems)
  if (errors.length > 0) {
    throw new Error(errors.join('；'))
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.lineCents, 0)

  const taxBp = await getTaxRateBp(env)
  const taxCents = Math.round((subtotalCents * taxBp) / 10000)

  let tipCents = 0
  if (tipPercent && tipPercent > 0) {
    const pct = Math.min(Math.max(tipPercent, 0), 30)
    tipCents = Math.round((subtotalCents * pct) / 100)
  }

  const totalCents = subtotalCents + taxCents + tipCents

  return {
    lines,
    subtotalCents,
    taxCents,
    tipCents,
    totalCents,
    currency: DEFAULT_CURRENCY,
  }
}
