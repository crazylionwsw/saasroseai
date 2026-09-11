# PAYMENT — 支付设计

## 抽象
```ts
interface PaymentProvider {
  createCheckout(params): Promise<CheckoutResult>;
  getPayment(providerPaymentId): Promise<PaymentResult>;
  refund(providerPaymentId, amountCents, reason?): Promise<RefundResult>;
  verifyWebhook(request): Promise<WebhookEvent>;
}
```
实现：`StripePaymentProvider`（`payment-provider.ts`）、`SquarePaymentProvider`（`square-provider.ts`）。

## 流程
```
Order(draft) → POST /api/payments/create → Provider Checkout
   → 插入 payments(pending) → Order=pending_payment
Customer 支付 → Provider Webhook
   → 验签 → payment_events 幂等 → Payment=succeeded → Order=paid
   → OrderNotifier 广播 → 商户后台
```

## Stripe
- Checkout Session（`mode=payment`，currency=cad）。
- 验签：`Stripe-Signature` HMAC-SHA256，`t` 时间戳容忍 300s，常量时间比较。
- Connect：`payment_accounts` 存 connected account；Checkout 带 `Stripe-Account` 头直连收款。
- OAuth：`POST /api/stripe/connect/start`（HMAC state）→ `GET /api/stripe/connect/callback`。

## Square
- Payment Links（`/v2/online-checkout/payment-links`，金额 cents）。
- 验签：`X-Square-Signature` = Base64(HMAC-SHA256(signatureKey, rawBody + timestamp))。
- OAuth：`POST /api/square/connect/start` → `GET /api/square/connect/callback`，access token 存 `payment_accounts`。

## 幂等与重入
- Webhook：`payment_events` UNIQUE(provider, provider_event_id)。
- 创建支付：若订单已 `pending_payment` 且存在 pending/processing 支付，返回同一 Checkout。

## 退款
`PaymentProvider.refund`；`refunds` 表记录；订单可转 `refunded`。
