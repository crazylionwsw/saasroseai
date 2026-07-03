import { AutoRouter, cors } from 'itty-router'
import { Env } from './types'
import { verifyMerchant } from './auth-middleware'
import { handleGenerateSite, handleGetTemplateList, handleGeneratePreview } from './storefront'
import { handleCreateOrder, handleGetOrder, handleListOrders, handleUpdateOrderStatus, handleGetMenu } from './order'
import { handleCreatePayment, handlePaymentCallback, handleQueryPayment } from './payment'
import { jsonResponse, errorResponse } from './utils'

const { preflight, corsify } = cors()
const router = AutoRouter({ before: [preflight], finally: [corsify] })

router.get('/api/health', () => jsonResponse({ status: 'ok' }))

router.post('/api/storefront/generate', (request: Request, env: Env) => request.json().then(data => handleGenerateSite(request, env, data)))
router.get('/api/storefront/templates', (_request: Request, env: Env) => handleGetTemplateList(env))
router.post('/api/storefront/preview', handleGeneratePreview)

router.get('/api/menu', handleGetMenu)

router.post('/api/orders', handleCreateOrder)
router.get('/api/orders', handleListOrders)
router.get('/api/orders/:orderId', handleGetOrder)
router.put('/api/orders/:orderId/status', handleUpdateOrderStatus)

router.post('/api/payments/create', handleCreatePayment)
router.post('/api/payments/callback', handlePaymentCallback)
router.get('/api/payments/:orderId', handleQueryPayment)

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const authResult = await verifyMerchant(env)
    if (authResult.status !== 'active') {
      return errorResponse('商户已停用', 403, 403)
    }
    return router.fetch(request, env, ctx)
  },
}
