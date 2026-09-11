# ARCHITECTURE — 系统架构

## 总体架构

```
┌─────────────────── Central (平台方 Cloudflare 账号) ───────────────────┐
│  Admin UI (Pages)  →  Central API Worker (D1 + R2 + AI)                │
│  商户管理 / 模板采集 / 模板市场 / 部署 / 审计日志                        │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ HTTPS (merchant JWT verify)
        ┌───────────────────────┴───────────────────────┐
        ▼                                                ▼
┌─────────────── Merchant A Worker ───────────────┐  ┌── Merchant N ──┐
│ D1: orders/menu/cart/payments/chat/call/...      │  │   (同构)       │
│ R2: ASSETS(模板/翻译) RECORDINGS(录音)            │  │                │
│ DO: ChatRoom / PhoneCall / OrderNotifier         │  │                │
│ Vectorize: KNOWLEDGE (RAG)                       │  │                │
│ Workers AI: Llama 3.1 8B + BGE embedding         │  │                │
└──────────────────────────────────────────────────┘  └────────────────┘
```

## 分层（商户 Worker）

```
UI (storefront / dashboard SPA / AI chat)
      ↓
HTTP Handlers (order.ts / cart.ts / payment.ts / ai-tools.ts ...)
      ↓
Domain (pricing.ts / order-state.ts / payment-state.ts / cart.ts)
      ↓
Repository (D1 参数化查询, merchant_id 过滤)
      ↓
D1 / R2 / Vectorize
```

- Web / QR / AI 共用 `pricing` / `order` / `payment` / `cart` 域。
- AI 通过 `ai-tools.ts` 的 typed tool 调用域服务，禁止直接 SQL。

## 支付适配层
`PaymentProvider` 接口：`createCheckout / getPayment / refund / verifyWebhook`。
实现：`StripePaymentProvider`、`SquarePaymentProvider`。

## 实时
`OrderNotifier` Durable Object 通过 WebSocket 广播订单事件，前端另有 20s 轮询兜底。

## 多租户
每商户独立 Worker + 独立 D1，租户键为 `env.MERCHANT_ID`；所有业务查询带 `merchant_id`。
RAG 检索按 `merchantId` metadata 过滤。
