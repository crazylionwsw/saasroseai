const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-xss-protection': '0',
}

export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  })
}

export function errorResponse(message: string, code: number, status: number = 400): Response {
  return jsonResponse({ error: message, code }, status)
}

export function generateId(prefix: string): string {
  return prefix + crypto.randomUUID().slice(0, 8)
}

export function generateOrderId(): string {
  const date = new Date()
  const y = date.getFullYear().toString()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `ORD-${y}${m}${d}-${rand}`
}

export function paginate(request: Request): { offset: number; limit: number } {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20))
  const offset = (page - 1) * limit
  return { offset, limit }
}
