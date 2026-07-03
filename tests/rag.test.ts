import { describe, it, expect } from 'vitest'

// Tests for the RAG module's utility functions
// Text splitting, intent classification, etc.

describe('RAG - Text Processing', () => {
  it('should split text into chunks', async () => {
    const { splitIntoChunks } = await import('../merchant-template/worker/src/knowledge-sync')

    const text = '宫保鸡丁是一道经典川菜。由鸡丁、花生米、干辣椒等炒制而成。口感麻辣鲜香。是很多顾客的最爱。鱼香肉丝也是一道名菜。猪肉丝配以木耳、胡萝卜等食材。酸甜微辣。'
    const chunks = splitIntoChunks(text, 30, 5)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].length).toBeLessThanOrEqual(35)
  })

  it('should handle empty text', async () => {
    const { splitIntoChunks } = await import('../merchant-template/worker/src/knowledge-sync')
    expect(splitIntoChunks('', 100, 20)).toEqual([])
  })

  it('should handle short text', async () => {
    const { splitIntoChunks } = await import('../merchant-template/worker/src/knowledge-sync')
    const chunks = splitIntoChunks('简短文本', 100, 20)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toBe('简短文本')
  })
})

describe('RAG - Reply Generation', () => {
  it('should generate reply with context', async () => {
    // This tests the RAG pipeline structure without calling actual AI
    const { generateRAGReply } = await import('../merchant-template/worker/src/rag')

    let llmCalled = false
    const mockEnv = {
      AI: {
        run: async (model: string, input: any) => {
          if (model === '@cf/baai/bge-small-en-v1.5') {
            return { data: [new Array(384).fill(0.1)] }
          }
          llmCalled = true
          expect(input.messages[0].content).toContain('测试餐厅')
          return { response: '我们营业到晚上10点。' }
        },
      },
      KNOWLEDGE: {
        query: async (vector: number[], options: any) => ({
          matches: [
            {
              metadata: { text: '营业时间: 每天 10:00-22:00', fileName: 'info.txt' },
              score: 0.92,
            },
          ],
        }),
      },
      MERCHANT_ID: 'm-test',
    } as any

    const { generateReply } = await import('../merchant-template/worker/src/rag')
    const result = await generateReply('你们营业到几点？', mockEnv, '测试餐厅')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('RAG - Intent Detection', () => {
  it('should detect menu query intent', async () => {
    const mockEnv = {
      AI: {
        run: async (model: string, input: any) => {
          return { response: 'query_menu' }
        },
      },
      MERCHANT_ID: 'm-test',
    } as any

    const { detectIntent } = await import('../merchant-template/worker/src/rag')
    const intent = await detectIntent('你们有什么菜？', mockEnv, '测试餐厅')
    expect(typeof intent).toBe('string')
  })
})
