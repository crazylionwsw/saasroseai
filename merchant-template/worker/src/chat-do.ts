import { DurableObject } from 'cloudflare:workers'
import { Env, Message } from './types'
import { generateId } from './utils'
import { executeTool } from './ai-tools'

interface PendingOrder {
  cartId: string
  items: string
  totalCents: number
  customerName?: string
  customerPhone?: string
  customerAddress?: string
}

interface ChatRoomState {
  merchantId: string
  customerId: string
  mode: 'ai' | 'human'
  assignedAgent?: string
  messages: Message[]
  knowledgeBaseId: string
  closed: boolean
  context: { chunks: string[]; documents: string[] }
  pendingOrder?: PendingOrder
}

const SUPPORTED_LANGS = ['zh', 'en', 'fr']
const DEFAULT_LANG = 'zh'
const ORDERING_RE = /(想要|我要|来一份|要一份|下单|点餐|点一份|订餐|帮我点|order|订)/i
const CONFIRM_RE = /^(是|好|对|可以|确认|下单|买单|yes|ok|y|sure|确认下单)/i
const DECLINE_RE = /(不要|不用|算了|取消|不了|no|not now)/i

export class ChatRoom extends DurableObject<Env> {
  state!: ChatRoomState
  server?: WebSocket
  merchantLang: string = DEFAULT_LANG

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
      await this.ensureLanguageLoaded()
    })
  }

  private async ensureLanguageLoaded(): Promise<void> {
    try {
      const merchant = await this.env.MERCHANT_DB.prepare(
        'SELECT language FROM merchant_info WHERE id = ?'
      ).bind(this.state.merchantId).first() as { language?: string } | null
      this.merchantLang = (merchant?.language && SUPPORTED_LANGS.includes(merchant.language))
        ? merchant.language : DEFAULT_LANG
    } catch {
      this.merchantLang = DEFAULT_LANG
    }
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

    if (!this.state.customerId) {
      this.state.customerId = generateId('c_')
      await this.ctx.storage.put('state', this.state)
    }

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

    let reply: string
    if (this.state.pendingOrder) {
      reply = await this.handleOrderConfirmation(text)
    } else if (ORDERING_RE.test(text)) {
      reply = await this.runOrderingFlow(text)
    } else {
      reply = await this.generateReply(text)
    }

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

  private formatMoney(cents: number): string {
    return `CAD ${(cents / 100).toFixed(2)}`
  }

  private async extractOrderRequest(text: string): Promise<{ items: { name: string; qty: number }[]; customerName?: string; customerPhone?: string; customerAddress?: string } | null> {
    try {
      const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'Extract a food order from the customer message. Return ONLY JSON: {"items":[{"name":"dish name","qty":number}],"customerName":"","customerPhone":"","customerAddress":""}. Items must be actual dish names from the message (e.g. 鸡肉炒饭). Return null if no order is present.' },
          { role: 'user', content: text },
        ],
      })
      const response = ((result as { response?: string }).response || '').trim()
      const parsed = JSON.parse(response)
      if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return null
      return parsed
    } catch {
      return null
    }
  }

  private async runOrderingFlow(text: string): Promise<string> {
    const extracted = await this.extractOrderRequest(text)
    if (!extracted) {
      return '请问需要点什么菜呢？您可以说“我想要两份鸡肉炒饭”。'
    }

    const resolved: { name: string; qty: number; itemId?: string }[] = []
    for (const line of extracted.items) {
      const search = await executeTool('search_menu', { query: line.name }, this.env)
      if (search.ok && Array.isArray(search.data) && search.data.length > 0) {
        const match = search.data.find((m: any) => m.isAvailable) || search.data[0]
        resolved.push({ name: match.name, qty: line.qty, itemId: match.id })
      } else {
        resolved.push({ name: line.name, qty: line.qty })
      }
    }

    const unknown = resolved.filter((r) => !r.itemId)
    if (unknown.length > 0) {
      return `抱歉，菜单中没有找到：${unknown.map((u) => u.name).join('、')}。请确认菜名。`
    }

    const cart = await executeTool('create_cart', {}, this.env)
    if (!cart.ok) return '创建购物车失败，请稍后再试。'
    const cartId = cart.data.cartId

    for (const line of resolved) {
      await executeTool('add_item', { cartId, itemId: line.itemId, qty: line.qty }, this.env)
    }

    const calc = await executeTool('calculate_cart', { cartId }, this.env)
    if (!calc.ok || !calc.data) return '计算价格失败，请稍后再试。'

    const totalCents = calc.data.totalCents || 0
    this.state.pendingOrder = {
      cartId,
      items: resolved.map((r) => `${r.name}x${r.qty}`).join(', '),
      totalCents,
      customerName: extracted.customerName,
      customerPhone: extracted.customerPhone || (this.state.customerId || undefined),
      customerAddress: extracted.customerAddress,
    }
    await this.ctx.storage.put('state', this.state)

    return `好的，您的订单：${this.state.pendingOrder.items}。合计 ${this.formatMoney(totalCents)}。需要下单吗？`
  }

  private async handleOrderConfirmation(text: string): Promise<string> {
    const pending = this.state.pendingOrder!
    if (DECLINE_RE.test(text)) {
      this.state.pendingOrder = undefined
      try {
        await this.env.MERCHANT_DB.prepare(
          `DELETE FROM cart_items WHERE cart_id = ? AND merchant_id = ?`
        ).bind(pending.cartId, this.state.merchantId).run()
      } catch {}
      await this.ctx.storage.put('state', this.state)
      return '好的，已为您取消。还有什么可以帮您？'
    }
    if (!CONFIRM_RE.test(text)) {
      return `您的订单：${pending.items}，合计 ${this.formatMoney(pending.totalCents)}。回复“确认下单”完成下单，或“取消”放弃。`
    }

    const order = await executeTool('create_order', {
      cartId: pending.cartId,
      orderType: 'pickup',
      customerName: pending.customerName,
      customerPhone: pending.customerPhone,
      customerAddress: pending.customerAddress,
    }, this.env)

    this.state.pendingOrder = undefined
    await this.ctx.storage.put('state', this.state)

    if (!order.ok) return `下单失败：${order.error}`
    const data = order.data

    if (data.requiresPayment) {
      const payment = await executeTool('create_payment', { orderId: data.orderId || data.id }, this.env)
      if (payment.ok && payment.data?.checkoutUrl) {
        return `已为您下单（订单号 ${data.orderId}），合计 ${this.formatMoney(data.totalCents)}。请点击完成支付：${payment.data.checkoutUrl}`
      }
      return `已为您下单（订单号 ${data.orderId}），合计 ${this.formatMoney(data.totalCents)}。请到收银台完成支付。`
    }

    return `下单成功！订单号 ${data.orderId}，合计 ${this.formatMoney(data.totalCents)}。我们会尽快为您准备。`
  }

  async generateReply(userMsg: string): Promise<string> {
    const chunks = await this.searchKnowledge(userMsg)
    const merchantName = this.state.merchantId
    const languageMap: Record<string, string> = { zh: 'Chinese (Mandarin)', en: 'English', fr: 'French' }
    const langName = languageMap[this.merchantLang] || 'English'

    const systemContent = `You are a customer service assistant for merchant "${merchantName}". Current mode: ${this.state.mode}. Use the following knowledge to answer the customer's question:\n\n${chunks.join('\n\n')}\n\nIMPORTANT: Respond in ${langName}.`

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
    const result = await this.env.KNOWLEDGE.query(vector, {
      topK: 5,
      filter: { merchantId: this.env.MERCHANT_ID },
    })
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
        `INSERT INTO chat_messages (id, session_id, merchant_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        msg.id,
        sessionId,
        this.state.merchantId,
        msg.role,
        msg.content,
        new Date(msg.timestamp).toISOString(),
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
