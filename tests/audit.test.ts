import { describe, it, expect } from 'vitest'

describe('Central Audit Logs (TASK-050)', () => {
  it('lists audit logs with filters', async () => {
    const { handleListAuditLogs } = await import('../central/api/src/security')
    const env = {
      CENTRAL_DB: {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            all: async () => {
              if (sql.includes('FROM audit_logs') && sql.includes('WHERE')) {
                return { results: [{ id: 'aud-1', action: 'MERCHANT_CREATE', target_type: 'merchant', target_id: 'm-1', detail: 'x', ip: '1.2.3.4', created_at: '2026-01-01' }] }
              }
              if (sql.includes('FROM audit_logs')) {
                return { results: [{ id: 'aud-2', action: 'LOGIN_SUCCESS', target_type: 'admin', target_id: null, detail: '', ip: '', created_at: '2026-01-02' }] }
              }
              return { results: [] }
            },
            first: async () => ({ total: 2 }),
          }),
        }),
      },
    } as any
    const resp = await handleListAuditLogs(new Request('http://localhost/api/audit-logs?action=MERCHANT_CREATE'), env)
    const data: any = await resp.json()
    expect(resp.status).toBe(200)
    expect(data.logs.length).toBe(1)
    expect(data.logs[0].action).toBe('MERCHANT_CREATE')
  })
})

describe('AI Analytics (TASK-057)', () => {
  it('returns session stats, message count and tool usage', async () => {
    const { handleAiAnalytics } = await import('../merchant-template/worker/src/merchant-admin')
    const env = {
      MERCHANT_ID: 'm-1',
      MERCHANT_DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            all: async () => {
              if (sql.includes('chat_sessions')) return { results: [{ status: 'closed', count: 3 }] }
              if (sql.includes('ai_tool')) return { results: [{ tool: 'search_menu', count: 5 }] }
              return { results: [] }
            },
            first: async () => ({ total: 7 }),
          }),
        }),
      },
    } as any
    const resp = await handleAiAnalytics(new Request('http://localhost/api/merchant/analytics/ai'), env)
    const data: any = await resp.json()
    expect(data.sessions[0].status).toBe('closed')
    expect(data.totalMessages).toBe(7)
    expect(data.toolUsage[0].tool).toBe('search_menu')
  })
})
