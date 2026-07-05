import type { Env } from './types'
import { sanitizeError, logAudit, getClientIP } from './security'

const DEPLOYMENT_SAFE_COLUMNS = [
  'id', 'merchant_id', 'version', 'template_version', 'status',
  'worker_url', 'pages_url', 'started_at', 'completed_at', 'error_log', 'deployed_by',
]

const DEPLOYMENT_ALLOWED_UPDATES = new Set([
  'status', 'worker_url', 'pages_url', 'cf_deployment_id', 'error_log', 'completed_at',
])

const DEPLOYMENT_VALID_STATUSES = ['pending', 'deploying', 'success', 'failed']

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(error: string, code: number): Response {
  return new Response(JSON.stringify({ error, code }), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })
}

export async function handleListDeployments(request: Request, env: Env, merchantId: string): Promise<Response> {
  try {
    if (!merchantId || typeof merchantId !== 'string') {
      return errorResponse('商户ID无效', 400)
    }
    const cols = DEPLOYMENT_SAFE_COLUMNS.join(', ')
    const { results } = await env.CENTRAL_DB.prepare(
      `SELECT ${cols} FROM deployments WHERE merchant_id = ? ORDER BY started_at DESC`
    ).bind(merchantId).all()
    return jsonResponse({ deployments: results })
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}

export async function handleCreateDeployment(request: Request, env: Env, merchantId: string): Promise<Response> {
  try {
    if (!merchantId || typeof merchantId !== 'string') {
      return errorResponse('商户ID无效', 400)
    }
    const body = await request.json() as Record<string, any>
    const { version, templateVersion, deployedBy } = body
    const safeVersion = (version || new Date().toISOString().replace(/[:.]/g, '-')).slice(0, 50)
    const id = 'd-' + crypto.randomUUID().slice(0, 8)
    const startedAt = new Date().toISOString()
    await env.CENTRAL_DB.prepare(
      'INSERT INTO deployments (id, merchant_id, version, template_version, status, started_at, deployed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, merchantId, safeVersion, (templateVersion || '').slice(0, 50), 'pending', startedAt, (deployedBy || '').slice(0, 100) || null).run()
    const cols = DEPLOYMENT_SAFE_COLUMNS.join(', ')
    const deployment = await env.CENTRAL_DB.prepare(`SELECT ${cols} FROM deployments WHERE id = ?`).bind(id).first()
    await logAudit(env, 'DEPLOYMENT_CREATE', 'deployment', id,
      `Created deployment for merchant ${merchantId}`, getClientIP(request))
    return jsonResponse(deployment, 201)
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}

export async function handleUpdateDeployment(request: Request, env: Env, deploymentId: string): Promise<Response> {
  try {
    if (!deploymentId || typeof deploymentId !== 'string') {
      return errorResponse('部署ID无效', 400)
    }
    const existing = await env.CENTRAL_DB.prepare('SELECT id FROM deployments WHERE id = ?').bind(deploymentId).first()
    if (!existing) return errorResponse('Deployment not found', 404)
    const body = await request.json() as Record<string, any>
    const updates: string[] = []
    const values: any[] = []
    for (const key of DEPLOYMENT_ALLOWED_UPDATES) {
      if (body[key] !== undefined) {
        if (key === 'status' && !DEPLOYMENT_VALID_STATUSES.includes(body[key])) {
          return errorResponse('部署状态值无效', 400)
        }
        updates.push(`${key} = ?`)
        values.push(body[key])
      }
    }
    if (updates.length === 0) return errorResponse('No fields to update', 400)
    values.push(deploymentId)
    await env.CENTRAL_DB.prepare(`UPDATE deployments SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    const cols = DEPLOYMENT_SAFE_COLUMNS.join(', ')
    const deployment = await env.CENTRAL_DB.prepare(`SELECT ${cols} FROM deployments WHERE id = ?`).bind(deploymentId).first()
    await logAudit(env, 'DEPLOYMENT_UPDATE', 'deployment', deploymentId,
      `Updated: ${updates.join(', ')}`, getClientIP(request))
    return jsonResponse(deployment)
  } catch (e) {
    return errorResponse(sanitizeError(e), 500)
  }
}
