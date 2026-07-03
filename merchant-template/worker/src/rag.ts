interface Env {
  KNOWLEDGE: VectorizeIndex
  AI: Ai
  MERCHANT_ID: string
  MERCHANT_DB: D1Database
}

interface RAGResult {
  answer: string
  chunks: { text: string; score: number; source: string }[]
  tokenUsage: { prompt: number; completion: number }
}

export async function searchKnowledge(
  query: string,
  env: Env,
  topK: number = 5
): Promise<{ text: string; score: number; source: string }[]> {
  const embedding = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [query] })
  const vector = (embedding as { data: number[][] }).data[0]

  const result = await env.KNOWLEDGE.query(vector, {
    topK,
    filter: { merchantId: env.MERCHANT_ID },
  })

  const chunks: { text: string; score: number; source: string }[] = []
  for (const match of result.matches) {
    if (match.metadata?.text) {
      chunks.push({
        text: match.metadata.text as string,
        score: match.score ?? 0,
        source: (match.metadata.fileName as string) || '',
      })
    }
  }

  chunks.sort((a, b) => b.score - a.score)
  return chunks
}

export async function generateRAGReply(
  query: string,
  systemContext: string,
  env: Env,
  history?: { role: string; content: string }[]
): Promise<RAGResult> {
  const foundChunks = await searchKnowledge(query, env)

  const contextText = foundChunks
    .map(c => `[来源: ${c.source}](相关度: ${c.score.toFixed(3)})\n${c.text}`)
    .join('\n\n---\n\n')

  const systemPrompt = `${systemContext}

以下是知识库中与顾客问题相关的信息：

${contextText || '（未找到相关知识）'}

要求：
1. 只用以上提供的信息回答顾客问题
2. 如果提供的信息不足以回答，请说"我查一下再回复你"
3. 不要编造信息
4. 回答简洁自然`

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ]

  if (history) {
    const recentHistory = history.slice(-10)
    for (const msg of recentHistory) {
      if (msg.role === 'system') continue
      messages.push(msg)
    }
  }

  messages.push({ role: 'user', content: query })

  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages,
    stream: false,
  })

  const llmResult = result as { response?: string; usage?: { prompt_tokens: number; completion_tokens: number } }

  return {
    answer: llmResult.response || '',
    chunks: foundChunks,
    tokenUsage: {
      prompt: llmResult.usage?.prompt_tokens || 0,
      completion: llmResult.usage?.completion_tokens || 0,
    },
  }
}

export async function generateReply(
  query: string,
  env: Env,
  merchantName: string,
  conversationHistory?: { role: string; content: string }[]
): Promise<string> {
  const systemContext = `你是${merchantName}的AI客服。回答简洁、自然、口语化。`
  const result = await generateRAGReply(query, systemContext, env, conversationHistory)
  return result.answer
}

const INTENTS = [
  'query_menu',
  'place_order',
  'query_hours',
  'query_address',
  'query_info',
  'transfer_human',
  'end_call',
  'general',
] as const

export async function detectIntent(
  text: string,
  env: Env,
  merchantName: string
): Promise<string> {
  const systemPrompt = `你是${merchantName}的AI客服。请判断用户意图，只返回以下意图之一（不要返回其他文字）：

${INTENTS.map(i => `- ${i}`).join('\n')}

意图说明：
- query_menu: 询问菜单、菜品、推荐菜
- place_order: 下单、点餐
- query_hours: 询问营业时间
- query_address: 询问地址、位置
- query_info: 询问其他信息
- transfer_human: 要求转人工
- end_call: 结束通话/对话
- general: 其他一般对话`

  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
  })

  const response = (result as { response?: string }).response || ''
  const trimmed = response.trim().toLowerCase()

  for (const intent of INTENTS) {
    if (trimmed.includes(intent)) return intent
  }

  return 'general'
}

export async function generateSummary(
  conversation: { role: string; text: string }[],
  env: Env,
  merchantName: string
): Promise<string> {
  const conversationText = conversation
    .map(m => `[${m.role}] ${m.text}`)
    .join('\n')

  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      {
        role: 'system',
        content: `你是${merchantName}的AI客服。请用不超过100字总结以下对话，包含：顾客需求、是否下单、特殊要求。`,
      },
      { role: 'user', content: conversationText },
    ],
  })

  return (result as { response?: string }).response || ''
}
