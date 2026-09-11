# SECURITY — 安全规范

## 租户隔离
- 每商户独立 Worker + 独立 D1；所有业务查询带 `merchant_id = env.MERCHANT_ID`。
- RAG 检索按 Vectorize metadata `merchantId` 过滤，禁止跨租户检索。
- 跨租户安全测试：`tests/*` 覆盖价格/订单/支付/cart 的 tenant 过滤。

## 认证与授权
- 平台：Admin Master Token（`timingSafeEqual`）+ 管理员 JWT（role=admin）。
- 商户后台：员工账号 + 角色（owner/manager/staff），PBKDF2-SHA256 密码哈希，
  会话 token 仅存 SHA-256 哈希，HttpOnly Cookie / Bearer。
- 所有商户管理 API 经 RBAC 守卫；客户接口（菜单/下单/支付创建）保持公开。

## 支付安全
- Webhook 必须验签：Stripe HMAC-SHA256（`Stripe-Signature`，300s 容忍）；
  Square HMAC-SHA256 Base64（`X-Square-Signature`）。
- 幂等：`payment_events` UNIQUE(provider, provider_event_id)。
- 禁止 `Browser → success=true → Order=PAID`；仅 Webhook 可将订单置为 `paid`。
- 支付状态机校验合法转换；金额以整数 cents 存储。
- 不存储卡信息；商户密钥/令牌经 Cloudflare Secrets 注入。

## 输入校验
- 全部外部输入做 schema 校验（类型/范围/白名单）。
- 金额由服务端重算，客户端只提交 `{id, qty, modifiers}`。
- 动态 SQL 列名走白名单（中央 `MERCHANT_UPDATE_COLUMNS`）。

## Secrets（禁止入库/入 Git）
`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_CLIENT_ID`、
`SQUARE_ACCESS_TOKEN`、`SQUARE_WEBHOOK_SIGNATURE_KEY`、`SQUARE_CLIENT_SECRET`、
`JWT_SECRET`、`ADMIN_API_TOKEN`、`MERCHANT_TOKEN`、Google Drive token。

## 其他
- 速率限制（中央 API，按 IP）。
- 安全响应头（`x-content-type-options` 等）。
- 审计日志（中央 `audit_logs`）。
- 错误信息不泄漏内部细节（`sanitizeError`）。
