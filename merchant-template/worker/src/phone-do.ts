import { DurableObject } from 'cloudflare:workers'

interface CallState {
  callSid: string
  merchantId: string
  customerNumber: string
  status: 'greeting' | 'listening' | 'processing' | 'speaking' | 'transferring' | 'ended'
  conversation: { role: string; text: string }[]
  context: { chunks: string[] }
  recordingUrl?: string
  duration: number
  hangup: boolean
  startedAt: number
}

interface Env {
  MERCHANT_DB: D1Database
  RECORDINGS: R2Bucket
  KNOWLEDGE: VectorizeIndex
  AI: Ai
  MERCHANT_ID: string
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_PHONE_NUMBER: string
}

export class PhoneCall extends DurableObject {
  private state: CallState
  private env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.env = env
    this.state = {
      callSid: '',
      merchantId: env.MERCHANT_ID,
      customerNumber: '',
      status: 'ended',
      conversation: [],
      context: { chunks: [] },
      duration: 0,
      hangup: false,
      startedAt: 0,
    }
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<CallState>('state')
      if (stored) this.state = stored
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    let formData: FormData | null = null
    try {
      formData = await request.formData()
    } catch {}

    if (url.pathname.endsWith('/incoming-call') || url.pathname === '/') {
      return this.handleIncomingCall(formData!)
    }
    if (url.pathname.endsWith('/process-speech')) {
      return this.handleProcessSpeech(formData!)
    }
    if (url.pathname.endsWith('/transfer-status')) {
      return this.handleTransferStatus(formData!)
    }

    return new Response('Not Found', { status: 404 })
  }

  async handleIncomingCall(formData: FormData): Promise<Response> {
    const callSid = (formData?.get('CallSid') as string) || this.ctx.id.toString()
    const from = (formData?.get('From') as string) || ''

    this.state.callSid = callSid
    this.state.customerNumber = from
    this.state.status = 'greeting'
    this.state.hangup = false
    this.state.conversation = []
    this.state.duration = 0
    this.state.startedAt = Date.now()

    const merchant = await this.getMerchantInfo()
    const welcomeMessage = merchant?.name
      ? `Hello, you've reached ${merchant.name}. How can I help you today?`
      : 'Hello, how can I help you today?'

    this.state.conversation.push({ role: 'system', text: welcomeMessage })
    await this.ctx.storage.put('state', this.state)

    await this.ctx.storage.setAlarm(Date.now() + 15 * 60 * 1000)

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="3" action="/process-speech">
    <Say>${this.escapeXml(welcomeMessage)}</Say>
  </Gather>
</Response>`

    return this.twimlResponse(twiml)
  }

  async handleProcessSpeech(formData: FormData): Promise<Response> {
    const speechResult = (formData?.get('SpeechResult') as string) || ''
    const recordingUrl = (formData?.get('RecordingUrl') as string) || ''

    if (!speechResult.trim()) {
      this.state.status = 'listening'
      await this.ctx.storage.put('state', this.state)
      return this.twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="3" action="/process-speech">
    <Say>I didn't catch that. Could you please say it again?</Say>
  </Gather>
</Response>`)
    }

    if (recordingUrl) {
      try {
        const resp = await fetch(recordingUrl)
        const audio = await resp.arrayBuffer()
        const key = `recordings/${this.state.callSid}/${Date.now()}.wav`
        await this.env.RECORDINGS.put(key, audio)
        this.state.recordingUrl = key
      } catch {}
    }

    this.state.status = 'processing'
    this.state.conversation.push({ role: 'user', text: speechResult })
    this.state.conversation = this.state.conversation.slice(-50)
    await this.ctx.storage.put('state', this.state)

    const responseText = await this.processUserInput(speechResult)

    if (this.state.hangup || this.state.status === 'ended') {
      return this.endCall()
    }

    if (this.state.status === 'transferring') {
      return this.twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please hold while I transfer you to a representative.</Say>
</Response>`)
    }

    this.state.status = 'speaking'
    this.state.conversation.push({ role: 'assistant', text: responseText })
    this.state.conversation = this.state.conversation.slice(-50)
    await this.ctx.storage.put('state', this.state)

    await this.ctx.storage.setAlarm(Date.now() + 15 * 60 * 1000)

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="5" action="/process-speech">
    <Say>${this.escapeXml(responseText)}</Say>
  </Gather>
</Response>`

    return this.twimlResponse(twiml)
  }

  async processUserInput(transcript: string): Promise<string> {
    const intent = await this.detectIntent(transcript)

    switch (intent) {
      case 'query_menu': {
        const chunks = await this.searchKnowledge('menu items dishes prices')
        this.state.context.chunks = chunks
        await this.ctx.storage.put('state', this.state)
        return this.generateResponse(transcript, intent)
      }
      case 'place_order': {
        const orderInfo = await this.extractOrderInfo(transcript)
        if (orderInfo) {
          await this.createOrder(orderInfo)
        }
        return this.generateResponse(transcript, intent)
      }
      case 'query_hours': {
        const chunks = await this.searchKnowledge('business hours opening hours')
        this.state.context.chunks = chunks
        await this.ctx.storage.put('state', this.state)
        return this.generateResponse(transcript, intent)
      }
      case 'query_address': {
        const merchant = await this.getMerchantInfo()
        if (merchant?.address) {
          this.state.context.chunks = [`The address is ${merchant.address}`]
        } else {
          const chunks = await this.searchKnowledge('address location')
          this.state.context.chunks = chunks
        }
        await this.ctx.storage.put('state', this.state)
        return this.generateResponse(transcript, intent)
      }
      case 'transfer_human': {
        const merchant = await this.getMerchantInfo()
        if (merchant?.phone) {
          await this.transferToHuman(merchant.phone)
        }
        return 'Please hold while I transfer you to a representative.'
      }
      case 'end_call': {
        this.state.hangup = true
        return 'Thank you for calling. Have a great day!'
      }
      default: {
        return this.generateResponse(transcript, intent)
      }
    }
  }

  async detectIntent(text: string): Promise<string> {
    const prompt = `Classify the intent of this customer message for a restaurant phone call. Choose exactly one word from the list:
- query_menu: asking about menu, food items, prices, ingredients, recommendations, specials
- place_order: wants to order food, place an order, specify items and quantities, delivery
- query_hours: asking about business hours, opening time, closing time, when are you open
- query_address: asking about address, location, directions, where are you
- transfer_human: wants to speak to a human, manager, real person, complains, talk to someone
- end_call: saying goodbye, ending call, hang up, bye, that's all, thank you and bye
- general: anything else including greetings

Message: "${text}"

Respond with only the intent name.`

    try {
      const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You categorize messages into intent categories. Reply with a single word only.' },
          { role: 'user', content: prompt },
        ],
      })
      const response = ((result as { response?: string }).response || 'general').trim().toLowerCase()
      const validIntents = ['query_menu', 'place_order', 'query_hours', 'query_address', 'transfer_human', 'end_call', 'general']
      return validIntents.includes(response) ? response : 'general'
    } catch {
      return 'general'
    }
  }

  async generateResponse(userText: string, intent: string): Promise<string> {
    const merchant = await this.getMerchantInfo()
    const merchantName = merchant?.name || 'the restaurant'

    const relevantChunks = intent === 'query_menu' || intent === 'place_order' || intent === 'query_hours'
      ? await this.searchKnowledge(userText)
      : this.state.context.chunks

    const knowledgeBase = relevantChunks.length > 0
      ? relevantChunks.join('\n\n')
      : 'No specific information available.'

    const systemContent = `You are a friendly phone assistant for ${merchantName}. 
Business info: name=${merchant?.name || 'N/A'}, address=${merchant?.address || 'N/A'}, phone=${merchant?.phone || 'N/A'}, hours=${merchant?.businessHours || 'N/A'}
Knowledge:\n${knowledgeBase}
Intent: ${intent}

Keep responses very concise and conversational — this is a phone call. Speak naturally. Never use markdown, emoji, or special characters. If you don't know something, politely say so and offer to transfer.`

    try {
      const messages = [
        { role: 'system', content: systemContent } as const,
        ...this.state.conversation.slice(-6).map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant' as const,
          content: m.text,
        })),
        { role: 'user' as const, content: userText },
      ]

      const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages })
      return ((result as { response?: string }).response || '').trim() || 'I apologize, could you please repeat that?'
    } catch {
      return 'I apologize for the technical difficulty. Please try again.'
    }
  }

  async say(text: string): Promise<string> {
    return `<Say>${this.escapeXml(text)}</Say>`
  }

  async transferToHuman(phoneNumber: string): Promise<Response> {
    this.state.status = 'transferring'
    await this.ctx.storage.put('state', this.state)

    await this.recordTransferEvent(phoneNumber)

    return this.twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="/transfer-status">${this.escapeXml(phoneNumber)}</Dial>
</Response>`)
  }

  async endCall(): Promise<Response> {
    this.state.status = 'ended'
    this.state.duration = this.state.startedAt > 0
      ? Math.floor((Date.now() - this.state.startedAt) / 1000)
      : 0

    try {
      const summary = await this.generateSummary()
      await this.env.MERCHANT_DB.prepare(
        `INSERT INTO call_records (call_sid, merchant_id, customer_number, status, duration, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        this.state.callSid,
        this.state.merchantId,
        this.state.customerNumber,
        'ended',
        this.state.duration,
        summary,
        new Date().toISOString(),
      ).run()
    } catch {}

    if (this.state.conversation.length > 50) {
      const archive = this.state.conversation.slice(0, this.state.conversation.length - 50)
      this.state.conversation = this.state.conversation.slice(-50)
      try {
        await this.env.MERCHANT_DB.prepare(
          `INSERT INTO call_conversation_archive (call_sid, conversation) VALUES (?, ?)`
        ).bind(this.state.callSid, JSON.stringify(archive)).run()
      } catch {}
    }

    await this.ctx.storage.put('state', this.state)
    await this.ctx.storage.deleteAlarm()

    return this.twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`)
  }

  async generateSummary(): Promise<string> {
    if (this.state.conversation.length === 0) return ''

    const conversationText = this.state.conversation
      .filter(m => m.role !== 'system')
      .map(m => `[${m.role}]: ${m.text}`)
      .join('\n')

    try {
      const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'Summarize the following phone conversation in 2-3 sentences.' },
          { role: 'user', content: conversationText },
        ],
      })
      return (result as { response?: string }).response || ''
    } catch {
      return ''
    }
  }

  async handleTransferStatus(formData: FormData): Promise<Response> {
    const status = (formData?.get('DialCallStatus') as string) || ''
    if (status === 'completed' || status === 'answered') {
      this.state.status = 'ended'
      await this.ctx.storage.put('state', this.state)
    }
    return this.twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`)
  }

  async alarm(): Promise<void> {
    if (this.state.status === 'ended') return

    this.state.status = 'ended'
    this.state.duration = this.state.startedAt > 0
      ? Math.floor((Date.now() - this.state.startedAt) / 1000)
      : 900

    await this.ctx.storage.put('state', this.state)

    try {
      const summary = await this.generateSummary()
      await this.env.MERCHANT_DB.prepare(
        `INSERT INTO call_records (call_sid, merchant_id, customer_number, status, duration, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        this.state.callSid,
        this.state.merchantId,
        this.state.customerNumber,
        'timeout',
        this.state.duration,
        summary || 'Call timed out after 15 minutes of inactivity.',
        new Date().toISOString(),
      ).run()
    } catch {}
  }

  private async getMerchantInfo(): Promise<{ name?: string; address?: string; phone?: string; businessHours?: string } | null> {
    try {
      const result = await this.env.MERCHANT_DB.prepare(
        'SELECT name, address, phone, business_hours FROM merchant_info WHERE id = ?'
      ).bind(this.state.merchantId).first() as { name?: string; address?: string; phone?: string; business_hours?: string } | null
      if (!result) return null
      return {
        name: result.name,
        address: result.address,
        phone: result.phone,
        businessHours: result.business_hours,
      }
    } catch {
      return null
    }
  }

  private async searchKnowledge(query: string): Promise<string[]> {
    try {
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
    } catch {
      return []
    }
  }

  private async extractOrderInfo(text: string): Promise<{ items: string; address?: string; customerName?: string } | null> {
    try {
      const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'Extract order information from the message. Return ONLY a JSON object with fields: items (string required), address (string optional), customerName (string optional). If you cannot identify any order items, return null.' },
          { role: 'user', content: text },
        ],
      })
      const response = ((result as { response?: string }).response || '').trim()
      const parsed = JSON.parse(response)
      return parsed?.items ? { items: parsed.items, address: parsed.address, customerName: parsed.customerName } : null
    } catch {
      return null
    }
  }

  private async createOrder(orderInfo: { items: string; address?: string; customerName?: string }): Promise<void> {
    try {
      const orderId = 'ORD_' + crypto.randomUUID().slice(0, 8)
      await this.env.MERCHANT_DB.prepare(
        `INSERT INTO orders (id, merchant_id, customer_name, customer_phone, customer_address, items, subtotal, total, status, payment_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'pending', 'unpaid', ?, ?)`
      ).bind(
        orderId,
        this.state.merchantId,
        orderInfo.customerName || null,
        this.state.customerNumber,
        orderInfo.address || null,
        orderInfo.items,
        new Date().toISOString(),
        new Date().toISOString(),
      ).run()
    } catch {}
  }

  private async recordTransferEvent(phoneNumber: string): Promise<void> {
    try {
      await this.env.MERCHANT_DB.prepare(
        `INSERT INTO call_transfers (call_sid, merchant_id, target_number, created_at) VALUES (?, ?, ?, ?)`
      ).bind(
        this.state.callSid,
        this.state.merchantId,
        phoneNumber,
        new Date().toISOString(),
      ).run()
    } catch {}
  }

  private twimlResponse(body: string): Response {
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}
