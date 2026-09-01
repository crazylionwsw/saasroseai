import { DurableObject } from 'cloudflare:workers'
import { Env } from './types'

interface NotifyEvent {
  type: 'order.created' | 'order.updated' | 'order.paid'
  orderId: string
  status: string
  paymentStatus?: string
  totalCents?: number
  customerName?: string
  createdAt?: string
}

export class OrderNotifier extends DurableObject<Env> {
  private clients = new Set<WebSocket>()

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Internal broadcast endpoint (worker -> DO)
    if (url.pathname === '/__broadcast' && request.method === 'POST') {
      const event = await request.json<NotifyEvent>()
      const payload = JSON.stringify({ type: 'notification', event })
      for (const client of this.clients) {
        try {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload)
          }
        } catch {}
      }
      return new Response('ok')
    }

    // WebSocket upgrade for dashboard clients
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.clients.add(server)
      server.accept()
      server.send(JSON.stringify({ type: 'ready' }))
      server.addEventListener('close', () => this.clients.delete(server))
      server.addEventListener('error', () => this.clients.delete(server))
      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('Not Found', { status: 404 })
  }
}

export function getNotifierStub(env: Env) {
  const id = env.ORDER_NOTIFY_DO.idFromName(env.MERCHANT_ID)
  return env.ORDER_NOTIFY_DO.get(id)
}

export async function notifyOrderChanged(env: Env, event: NotifyEvent): Promise<void> {
  try {
    const stub = getNotifierStub(env)
    await stub.fetch('https://internal/__broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch {}
}
