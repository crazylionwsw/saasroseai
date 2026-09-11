# AGENTS.md — Rose SaaS 开发规范

本文件是 AI/开发者在本仓库工作的最高约束。任何改动前必须阅读本文件与 `docs/` 下相关文档。

## 项目目标

面向加拿大中小餐厅的 SaaS：官网、在线点餐、QR 点餐、Stripe/Square 支付、AI 客服与 AI 下单、RAG 知识库、商户后台、平台中央管理，全部基于 Cloudflare Serverless。

## 目录结构

```
central/            # 中央平台
  api/              #   中央 API Worker（商户管理/模板/部署/审计）
  admin-ui/         #   平台后台 SPA（Pages）
  migrations/       #   中央 D1 迁移
  schema.sql
merchant-template/  # 每商户一份
  worker/           #   商户 Worker（订单/支付/AI/网站）
    src/
    migrations/     #   商户 D1 迁移
    schema.sql
  templates/        #   官网模板（classic / modern）
  translations/     #   zh / en / fr
tests/              # Vitest 测试
docs/               # 设计文档
```

## 开发流程

READ → INSPECT → PLAN → IMPLEMENT → TEST → SECURITY REVIEW → CODE REVIEW → REPORT

禁止未读代码直接修改。发现未来功能时只记录 TODO，不在当前任务顺手实现。

## 硬规则

1. 多租户隔离：商户数据必须按 `merchant_id` 过滤（中央按商户、商户 Worker 按 `env.MERCHANT_ID`）。
2. 域服务：Web / QR / AI 共用同一套 Cart / Pricing / Order / Payment 逻辑，禁止各自实现。
3. 价格真相在服务器：客户端只提交 `{id, qty, modifiers}`，服务端重算。
4. 金额一律整数 cents；默认货币 CAD。
5. 订单状态机、支付状态机必须校验合法转换。
6. 支付回调必须验签 + 幂等（`payment_events` UNIQUE(provider, provider_event_id)）。
7. 禁止 `Browser → success=true → Order=PAID`。
8. AI 只能通过 typed tool 调用域服务，不能直接 SQL/改价/改支付状态。
9. 密钥禁止入库/入 Git，使用 Cloudflare Secrets。
10. 商户管理 API 必须经 RBAC 鉴权（owner/manager/staff）。

## 提交规范

每个任务一个 commit：`feat(task-XXX): ...`。禁止 `feat: update everything`。

## 测试

```bash
npx tsc --noEmit
npx vitest run --config tests/vitest.config.ts
```

## 部署

```bash
npx wrangler deploy --config central/api/wrangler.jsonc
npx wrangler pages deploy central/admin-ui/src --project-name rose-saas-admin --branch main
```
