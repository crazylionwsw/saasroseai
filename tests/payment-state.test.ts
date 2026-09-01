import { describe, it, expect } from 'vitest'

describe('Payment State Machine', () => {
  it('allows legal transitions', async () => {
    const { canTransitionPayment } = await import('../merchant-template/worker/src/payment-state')
    expect(canTransitionPayment('pending', 'processing')).toBe(true)
    expect(canTransitionPayment('pending', 'succeeded')).toBe(true)
    expect(canTransitionPayment('pending', 'failed')).toBe(true)
    expect(canTransitionPayment('processing', 'succeeded')).toBe(true)
    expect(canTransitionPayment('succeeded', 'refunded')).toBe(true)
    expect(canTransitionPayment('succeeded', 'partially_refunded')).toBe(true)
    expect(canTransitionPayment('failed', 'pending')).toBe(true)
  })

  it('blocks illegal transitions', async () => {
    const { canTransitionPayment } = await import('../merchant-template/worker/src/payment-state')
    expect(canTransitionPayment('not_required', 'succeeded')).toBe(false)
    expect(canTransitionPayment('refunded', 'pending')).toBe(false)
    expect(canTransitionPayment('succeeded', 'failed')).toBe(false)
    expect(canTransitionPayment('cancelled', 'processing')).toBe(false)
  })
})
