import { DurableObject } from 'cloudflare:workers'
import { Env, Message } from './types'
import { generateId } from './utils'

interface ChatRoomState {
  merchantId: string
  customerId: string
  mode: 'ai' | 'human'
  assignedAgent?: string
  messages: Message[]
  knowledgeBaseId: string
  closed: boolean
  context: { chunks: string[]; documents: string[] }
}

export class ChatRoom extends DurableObject {
  private state: ChatRoomState
  private env: Env
  private server?: WebSocket

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.env = env
    this.state = {
      merchantId: env.MERCHANT_ID,
      customerId: '',
      mode: 'ai',
      messages: [],
      knowledgeBaseId: env.MERCHANT_ID,
      closed: false,
      context: { chunks: [], documents: [] },
    }
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<ChatRoomState>('state')
      if (stored) this.state = stored
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 400 })
    }
    return this.handleWebSocket(request)
  }

  async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.server = server

    server.accept()

    const history = this.state.messages.slice(-10)
    server.send(JSON.stringify({
      type: 'welcome',
      merchantId: this.state.merchantId,
      history,
      mode: this.state.mode,
    }))

    server.addEventListener('message', async (event: MessageEvent) => {
      const raw = event.data as string
      let parsed: any
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = { text: raw }
      }

      if (parsed.type === 'switch_human') {
        await this.switchToHuman(parsed.agentId)
      } else if (parsed.type === 'switch_ai') {
        await this.switchToAI()
      } else if (parsed.type === 'close') {
        const summary = await this.closeSession()
        server.send(JSON.stringify({ type: 'closed', summary }))
      } else {
        await this.handleUserMessage(parsed.text || raw)
      }
    })

    server.addEventListener('close', async () => {
      if (!this.state.closed) {
        await this.closeSession()
      }
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  async handleUserMessage(text: string): Promise<void> {
    const msg: Message = {
      id: generateId('msg_'),
      role: 'customer',
      content: text,
      timestamp: Date.now(),
    }
    this.state.messages.push(msg)
    await this.ctx.storage.put('state', this.state)

    if (this.state.mode === 'human') {
      await this.notifyAgent()
      return
    }

    const reply = await this.generateReply(text)

    const aiMsg: Message = {
      id: generateId('msg_'),
      role: 'ai',
      content: reply,
      timestamp: Date.now(),
    }
    this.state.messages.push(aiMsg)
    await this.ctx.storage.put('state', this.state)

    this.server?.send(JSON.stringify({
      type: 'message',
      role: 'ai',
      content: reply,
      id: aiMsg.id,
    }))
  }

  async generateReply(userMsg: string): Promise<string> {
    const chunks = await this.searchKnowledge(userMsg)
    const merchantName = this.state.merchantId

    const systemContent = `You are a customer service assistant for merchant "${merchantName}". Current mode: ${this.state.mode}. Use the following knowledge to answer the customer's question:\n\n${chunks.join('\n\n')}`

    const recentMessages = this.state.messages.slice(-10)
    const llmMessages: { role: string; content: string }[] = [
      { role: 'system', content: systemContent },
      ...recentMessages.map(m => {
        const role = m.role === 'customer' ? 'user' : m.role === 'ai' || m.role === 'agent' ? 'assistant' : 'system'
        return { role, content: m.content }
      }),
    ]

    const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: llmMessages })
    const response = result as { response?: string }
    return response.response || ''
  }

  async searchKnowledge(query: string): Promise<string[]> {
    const embedding = await this.env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [query] })
    const vector = (embedding as { data: number[][] }).data[0]
    const result = await this.env.KNOWLEDGE.query(vector, { topK: 5 })
    const chunks = new Set<string>()
    for (const match of result.matches) {
      if (match.metadata?.text) {
        chunks.add(match.metadata.text as string)
      }
    }
    return Array.from(chunks)
  }

  async switchToHuman(agentId?: string): Promise<void> {
    this.state.mode = 'human'
    this.state.assignedAgent = agentId
    await this.ctx.storage.put('state', this.state)

    const msg: Message = {
      id: generateId('msg_'),
      role: 'system',
      content: 'You have been transferred to a human agent. Please wait while an agent joins the conversation.',
      timestamp: Date.now(),
    }
    this.state.messages.push(msg)
    await this.ctx.storage.put('state', this.state)

    this.server?.send(JSON.stringify({
      type: 'mode_change',
      mode: 'human',
      message: 'You have been transferred to a human agent.',
    }))

    await this.notifyAgent()
  }

  async switchToAI(): Promise<void> {
    this.state.mode = 'ai'
    await this.ctx.storage.put('state', this.state)

    const msg: Message = {
      id: generateId('msg_'),
      role: 'system',
      content: 'A human agent has transferred you back to AI assistant.',
      timestamp: Date.now(),
    }
    this.state.messages.push(msg)
    await this.ctx.storage.put('state', this.state)

    this.server?.send(JSON.stringify({
      type: 'mode_change',
      mode: 'ai',
      message: 'You are now talking to the AI assistant.',
    }))
  }

  async notifyAgent(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + 100)
  }

  async alarm(): Promise<void> {
    const webhookUrl = (this.env as any).AGENT_WEBHOOK_URL
    if (!webhookUrl) return

    const recentMessages = this.state.messages.slice(-5)
    const summary = recentMessages.map(m => `[${m.role}] ${m.content}`).join('\n')

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: this.state.merchantId,
          customerId: this.state.customerId,
          mode: this.state.mode,
          assignedAgent: this.state.assignedAgent,
          messageCount: this.state.messages.length,
          recentMessages: summary,
        }),
      })
    } catch {}
  }

  async closeSession(): Promise<string> {
    if (this.state.closed) return ''
    this.state.closed = true

    let summary = ''
    if (this.state.messages.length > 0) {
      try {
        const conversationText = this.state.messages
          .map(m => `[${m.role}] ${m.content}`)
          .join('\n')

        const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: 'Summarize the following customer service conversation in 2-3 sentences.' },
            { role: 'user', content: conversationText },
          ],
        })
        summary = (result as { response?: string }).response || ''
      } catch {}
    }

    const sessionId = generateId('sess_')
    const stmts = this.state.messages.map(msg =>
      this.env.MERCHANT_DB.prepare(
        `INSERT INTO chat_messages (id, merchant_id, customer_id, role, content, timestamp, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        msg.id,
        this.state.merchantId,
        this.state.customerId,
        msg.role,
        msg.content,
        msg.timestamp,
        sessionId,
      )
    )
    if (stmts.length > 0) {
      await this.env.MERCHANT_DB.batch(stmts)
    }

    this.state.context = { chunks: [], documents: [] }
    await this.ctx.storage.put('state', this.state)

    return summary
  }
}
