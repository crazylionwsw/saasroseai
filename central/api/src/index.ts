import { AutoRouter, cors } from 'itty-router'
import type { Env } from './types'
import { generateAdminToken, verifyAdminToken } from './auth'
import { handleListMerchants, handleGetMerchant, handleCreateMerchant, handleUpdateMerchant, handleDeleteMerchant, handleVerifyMerchant, handleRegenerateToken } from './merchants'
import { handleListDeployments, handleCreateDeployment, handleUpdateDeployment } from './deployments'
import { handleScrapeWebsite, handleGetScrapeJob, handleListScrapeJobs } from './template-scraper'
import {
  timingSafeEqual, checkRateLimit, validateMerchantInput,
  sanitizeError, getClientIP, logAudit, cleanupRateLimitStore,
} from './security'

const { preflight, corsify } = cors({
  allowedOrigins: ['https://rose-saas-admin.pages.dev', 'https://saas.roseai.ca', 'http://localhost:8788'],
  maxAge: 86400,
})

const SECURITY_HEADERS = {
  'content-type': 'application/json',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-xss-protection': '0',
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS },
  })
}

function errorResponse(error: string, code: number): Response {
  return new Response(JSON.stringify({ error, code }), {
    status: code,
    headers: { ...SECURITY_HEADERS },
  })
}

const PUBLIC_PATHS = ['/api/health', '/api/merchants/verify', '/api/auth/login']

function authGuard(request: Request, env: Env): Response | void {
  const url = new URL(request.url)
  if (PUBLIC_PATHS.includes(url.pathname)) return

  const auth = request.headers.get('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) {
    return errorResponse('Unauthorized', 401)
  }

  const token = auth.slice(7)
  if (timingSafeEqual(token, env.ADMIN_API_TOKEN)) return

  ;(request as any).__sessionToken = token
}

const router = AutoRouter({
  before: [preflight, authGuard],
  finally: [corsify],
})

// ── Auth ──
router.post('/api/auth/login', async (request: Request, env: Env): Promise<Response> => {
  const ip = getClientIP(request)

  const rl = checkRateLimit(ip, 'login')
  if (!rl.allowed) {
    return errorResponse(`请${rl.retryAfter}秒后再试`, 429)
  }

  try {
    const body = await request.json() as Record<string, unknown>
    if (typeof body.token !== 'string') {
      await logAudit(env, 'LOGIN_FAIL', 'admin', null, 'Missing token', ip)
      return errorResponse('Invalid admin token', 401)
    }

    // Timing-safe comparison
    const valid = timingSafeEqual(body.token, env.ADMIN_API_TOKEN)
    if (!valid) {
      await logAudit(env, 'LOGIN_FAIL', 'admin', null, 'Wrong admin token', ip)
      return errorResponse('Invalid admin token', 401)
    }

    const validation = validateMerchantInput(body)
    if (!validation.valid) {
      const daysErr = validation.errors.find(e => e.includes('有效期'))
      if (daysErr) {
        return errorResponse(daysErr, 400)
      }
    }

    const days = Math.max(1, Math.min(30, (body.days as number) || 7))
    const sessionToken = await generateAdminToken(env, days)
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString()

    await logAudit(env, 'LOGIN_SUCCESS', 'admin', null, `Session expires ${expiresAt}`, ip)

    return jsonResponse({
      token: sessionToken,
      expiresIn: days * 86400,
      expiresAt,
    })
  } catch {
    return errorResponse('Invalid admin token', 401)
  }
})

// ── Merchants ──
router.get('/api/merchants', handleListMerchants)

router.post('/api/merchants', async (request: Request, env: Env): Promise<Response> => {
  const ip = getClientIP(request)
  const rl = checkRateLimit(ip, 'sensitive')
  if (!rl.allowed) return errorResponse(`请${rl.retryAfter}秒后再试`, 429)
  return handleCreateMerchant(request, env)
})

router.get('/api/merchants/:merchantId', (request: Request, env: Env) => {
  return handleGetMerchant(request, env, (request as any).params.merchantId)
})

router.put('/api/merchants/:merchantId', async (request: Request, env: Env): Promise<Response> => {
  const merchantId = (request as any).params.merchantId
  const ip = getClientIP(request)
  const rl = checkRateLimit(ip, 'sensitive')
  if (!rl.allowed) return errorResponse(`请${rl.retryAfter}秒后再试`, 429)
  return handleUpdateMerchant(request, env, merchantId)
})

router.delete('/api/merchants/:merchantId', async (request: Request, env: Env): Promise<Response> => {
  const merchantId = (request as any).params.merchantId
  const ip = getClientIP(request)
  const rl = checkRateLimit(ip, 'sensitive')
  if (!rl.allowed) return errorResponse(`请${rl.retryAfter}秒后再试`, 429)
  return handleDeleteMerchant(request, env, merchantId)
})

router.post('/api/merchants/:merchantId/token', async (request: Request, env: Env): Promise<Response> => {
  const merchantId = (request as any).params.merchantId
  const ip = getClientIP(request)
  const rl = checkRateLimit(ip, 'sensitive')
  if (!rl.allowed) return errorResponse(`请${rl.retryAfter}秒后再试`, 429)
  return handleRegenerateToken(request, env, merchantId)
})

router.post('/api/merchants/verify', handleVerifyMerchant)

// ── Deployments ──
router.get('/api/merchants/:merchantId/deployments', (request: Request, env: Env) => {
  return handleListDeployments(request, env, (request as any).params.merchantId)
})

router.post('/api/merchants/:merchantId/deployments', async (request: Request, env: Env): Promise<Response> => {
  const merchantId = (request as any).params.merchantId
  const ip = getClientIP(request)
  const rl = checkRateLimit(ip, 'sensitive')
  if (!rl.allowed) return errorResponse(`请${rl.retryAfter}秒后再试`, 429)
  return handleCreateDeployment(request, env, merchantId)
})

router.put('/api/deployments/:deploymentId', async (request: Request, env: Env): Promise<Response> => {
  const deploymentId = (request as any).params.deploymentId
  const ip = getClientIP(request)
  const rl = checkRateLimit(ip, 'sensitive')
  if (!rl.allowed) return errorResponse(`请${rl.retryAfter}秒后再试`, 429)
  return handleUpdateDeployment(request, env, deploymentId)
})

// ── Templates ──
router.post('/api/templates/scrape', async (request: Request, env: Env): Promise<Response> => {
  const ip = getClientIP(request)
  const rl = checkRateLimit(ip, 'scrape')
  if (!rl.allowed) return errorResponse(`请${rl.retryAfter}秒后再试`, 429)
  return handleScrapeWebsite(request, env)
})

router.get('/api/templates/scrape/:jobId', (request: Request, env: Env) => {
  return handleGetScrapeJob(request, env, (request as any).params.jobId)
})
router.get('/api/templates/scrape-jobs', handleListScrapeJobs)

// ── Health ──
router.get('/api/health', () => jsonResponse({ status: 'ok' }))

// ── Main fetch ──
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Periodic rate limit cleanup
    cleanupRateLimitStore()

    // JWT session verification for non-public, non-master-token requests
    const url = new URL(request.url)
    if (!PUBLIC_PATHS.includes(url.pathname)) {
      const auth = request.headers.get('Authorization')
      if (auth && auth.startsWith('Bearer ')) {
        const token = auth.slice(7)
        if (!timingSafeEqual(token, env.ADMIN_API_TOKEN)) {
          const session = await verifyAdminToken(token, env)
          if (!session || session.role !== 'admin') {
            return errorResponse('Unauthorized', 401)
          }
        }
      }
    }

    return router.fetch(request, env, ctx)
  },
}
