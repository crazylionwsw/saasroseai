import { PaymentStatus } from './types'

export const ALL_PAYMENT_STATUSES: PaymentStatus[] = [
  'not_required',
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'refunded',
  'partially_refunded',
]

const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  not_required: [],
  pending: ['processing', 'succeeded', 'failed', 'cancelled'],
  processing: ['succeeded', 'failed', 'cancelled'],
  succeeded: ['refunded', 'partially_refunded'],
  failed: ['pending'],
  cancelled: ['pending'],
  refunded: [],
  partially_refunded: ['refunded'],
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function paymentTransitionError(from: PaymentStatus, to: PaymentStatus): string {
  return `非法支付状态转换: ${from} -> ${to}`
}
