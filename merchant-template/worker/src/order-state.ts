import { OrderStatus } from './types'

export const ALL_ORDER_STATUSES: OrderStatus[] = [
  'draft',
  'pending_payment',
  'paid',
  'confirmed',
  'preparing',
  'ready',
  'completed',
  'cancelled',
  'refunded',
]

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['pending_payment', 'paid', 'cancelled'],
  pending_payment: ['paid', 'cancelled', 'refunded'],
  paid: ['confirmed', 'cancelled', 'refunded'],
  confirmed: ['preparing', 'cancelled', 'refunded'],
  preparing: ['ready', 'cancelled', 'refunded'],
  ready: ['completed', 'cancelled'],
  completed: ['refunded'],
  cancelled: [],
  refunded: [],
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function orderTransitionError(from: OrderStatus, to: OrderStatus): string {
  return `非法订单状态转换: ${from} -> ${to}`
}

export function isInternalOrderStatus(status: OrderStatus): boolean {
  return status === 'paid' || status === 'refunded'
}
