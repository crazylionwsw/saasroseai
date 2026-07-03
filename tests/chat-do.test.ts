import { describe, it, expect } from 'vitest'

describe('ChatDO - Message Handling', () => {
  it('should generate reply using RAG', async () => {
    const { generateReply } = await import('../merchant-template/worker/src/rag')

    let llmCalled = false
    const mockEnv = {
      AI: {
        run: async (model: string, input: any) => {
          if (model === '@cf/baai/bge-small-en-v1.5') {
            return { data: [new Array(384).fill(0.1)] }
          }
          llmCalled = true
          return { response: '我们的招牌菜是宫保鸡丁，38元一份。' }
        },
      },
      KNOWLEDGE: {
        query: async (vector: number[], options: any) => ({
          matches: [
            {
              metadata: {
                text: '招牌菜: 宫保鸡丁 38元，鱼香肉丝 32元',
                fileName: 'menu.txt',
              },
              score: 0.95,
            },
          ],
        }),
      },
      MERCHANT_ID: 'm-test',
    } as any

    const result = await generateReply('你们有什么招牌菜？', mockEnv, '测试餐厅')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })

  it('should handle empty knowledge base gracefully', async () => {
    const mockEnv = {
      AI: {
        run: async (model: string) => {
          if (model === '@cf/baai/bge-small-en-v1.5') {
            return { data: [new Array(384).fill(0.1)] }
          }
          return { response: '我查一下再回复您。' }
        },
      },
      KNOWLEDGE: {
        query: async () => ({ matches: [] }),
      },
      MERCHANT_ID: 'm-test',
    } as any

    const { generateReply } = await import('../merchant-template/worker/src/rag')
    const result = await generateReply('你们的地址在哪？', mockEnv, '测试餐厅')
    expect(result).toBeTruthy()
  })
})

describe('ChatDO - Session Management', () => {
  it('should generate conversation summary', async () => {
    const { generateSummary } = await import('../merchant-template/worker/src/rag')

    const mockEnv = {
      AI: {
        run: async () => ({
          response: '顾客询问了营业时间和招牌菜，对宫保鸡丁感兴趣，未下单。',
        }),
      },
      MERCHANT_ID: 'm-test',
    } as any

    const conversation = [
      { role: 'customer', text: '你们营业到几点？' },
      { role: 'ai', text: '我们营业到晚上10点。' },
      { role: 'customer', text: '有什么招牌菜？' },
      { role: 'ai', text: '宫保鸡丁38元，很受欢迎。' },
    ]

    const summary = await generateSummary(conversation, mockEnv, '测试餐厅')
    expect(summary.length).toBeGreaterThan(0)
    expect(typeof summary).toBe('string')
  })
})
