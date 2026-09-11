import { describe, it, expect } from 'vitest'

function createRbacEnv() {
  const users: any[] = []
  const sessions: any[] = []
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('COUNT(*) as c FROM staff_users')) return { c: users.filter((u) => u.merchant_id === args[0]).length }
          if (sql.includes('FROM staff_users WHERE merchant_id = ? AND email = ?')) {
            return users.find((u) => u.merchant_id === args[0] && u.email === args[1]) || null
          }
          if (sql.includes('FROM staff_sessions s JOIN staff_users')) {
            return sessions.find((s) => s.token_hash === args[0] && s.merchant_id === args[1]) || null
          }
          return null
        },
        run: async () => {
          if (sql.includes('INSERT INTO staff_users')) {
            users.push({ id: args[0], merchant_id: args[1], email: args[2], role: args[3], password_hash: args[4], salt: args[5], is_active: 1 })
          } else if (sql.includes('INSERT INTO staff_sessions')) {
            sessions.push({ token_hash: args[0], user_id: args[1], merchant_id: args[2], role: args[3], expires_at: args[4], email: users.find((u) => u.id === args[1])?.email })
          } else if (sql.includes('DELETE FROM staff_sessions')) {
            const i = sessions.findIndex((s) => s.token_hash === args[0])
            if (i >= 0) sessions.splice(i, 1)
          }
          return { success: true, meta: { changes: 1 } }
        },
        all: async () => ({ results: users.filter((u) => u.merchant_id === args[0]) }),
      }),
    }),
  }
  return { MERCHANT_DB: db, MERCHANT_ID: 'm-1', MERCHANT_TOKEN: 'setup-secret', _users: users, _sessions: sessions } as any
}

async function setupOwner(env: any) {
  const { handleSetup } = await import('../merchant-template/worker/src/rbac')
  const req = new Request('http://localhost/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Setup-Token': 'setup-secret' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
  })
  return handleSetup(req, env)
}

describe('RBAC (TASK-003/005)', () => {
  it('creates the first owner via setup and rejects a second setup', async () => {
    const env = createRbacEnv()
    const first = await setupOwner(env)
    expect(first.status).toBe(201)
    const data: any = await first.json()
    expect(data.role).toBe('owner')
    expect(data.token).toBeTruthy()

    const second = await setupOwner(env)
    expect(second.status).toBe(409)
  })

  it('rejects setup without the correct setup token', async () => {
    const env = createRbacEnv()
    const { handleSetup } = await import('../merchant-template/worker/src/rbac')
    const req = new Request('http://localhost/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Token': 'wrong' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password123' }),
    })
    expect((await handleSetup(req, env)).status).toBe(403)
  })

  it('logs in with correct password and rejects wrong password', async () => {
    const env = createRbacEnv()
    await setupOwner(env)
    const { handleLogin } = await import('../merchant-template/worker/src/rbac')

    const ok = await handleLogin(new Request('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
    }), env)
    expect(ok.status).toBe(200)
    const okData: any = await ok.json()
    expect(okData.token).toBeTruthy()

    const bad = await handleLogin(new Request('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'wrongpass' }),
    }), env)
    expect(bad.status).toBe(401)
  })

  it('enforces route-level role requirements', async () => {
    const env = createRbacEnv()
    await setupOwner(env)
    const { handleLogin, authorizeMerchantRequest } = await import('../merchant-template/worker/src/rbac')

    const login = await handleLogin(new Request('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
    }), env)
    const { token } = await login.json() as any

    // public customer route
    const pub = await authorizeMerchantRequest(new Request('http://localhost/api/menu'), env)
    expect(pub).toBeNull()

    // admin route without session
    const noAuth = await authorizeMerchantRequest(new Request('http://localhost/api/merchant/menu', { method: 'PUT' }), env)
    expect(noAuth?.status).toBe(401)

    // admin route with owner session
    const withAuth = await authorizeMerchantRequest(new Request('http://localhost/api/merchant/menu', {
      method: 'PUT', headers: { 'Authorization': 'Bearer ' + token },
    }), env)
    expect(withAuth).toBeNull()

    // owner-only route with manager role should be 403
    const mgr = await import('../merchant-template/worker/src/rbac')
    expect(mgr.hasRole('manager', 'owner')).toBe(false)
    expect(mgr.hasRole('owner', 'manager')).toBe(true)
  })
})
