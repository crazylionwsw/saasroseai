# API — 接口文档

## 中央 API (`central/api`)
鉴权：`Authorization: Bearer <admin JWT>`（`POST /api/auth/login` 换取）。公开：`/api/health`、`/api/merchants/verify`、`/api/auth/login`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 管理员登录 |
| GET/POST | `/api/merchants` | 商户列表/创建 |
| GET/PUT/DELETE | `/api/merchants/:id` | 商户详情/更新/删除 |
| POST | `/api/merchants/:id/token` | 重新生成商户 token |
| POST | `/api/merchants/verify` | 商户状态校验（商户 Worker 调用） |
| POST | `/api/merchants/:id/deploy-cf` | 部署商户官网到其 CF Pages |
| POST/DELETE | `/api/merchants/:id/custom-domain` | 绑定/解绑自定义域名 |
| GET/POST | `/api/merchants/:id/deployments` | 部署记录 |
| POST | `/api/templates/scrape` | 采集网站→模板（支持 SSE 进度） |
| GET | `/api/templates` | 模板列表 |
| DELETE | `/api/templates/:id` | 删除模板（用量确认） |
| GET | `/api/audit-logs` | 审计日志 |
| GET/POST/PUT/DELETE | `/api/marketplace/templates` | 模板市场 |

## 商户 API (`merchant-template/worker`)
公开（客户）：`/api/health`、`/api/menu`、`/api/orders`(POST)、`/api/cart/*`、`/api/payments/create`、`/api/payments/webhook`、`/api/payments/webhook/square`、`/api/qr/verify`、`/api/storefront/*`、`/ws`、`/api/notifications/ws`。

需 RBAC（员工会话）：
| 方法 | 路径 | 最低角色 |
|---|---|---|
| POST | `/api/auth/login` / `logout` / `setup` | - |
| GET | `/api/auth/me` | staff |
| GET/PUT | `/api/merchant/profile` | manager |
| PUT | `/api/merchant/menu` | manager |
| GET/PUT | `/api/merchant/tax` | manager |
| GET/PUT/POST | `/api/merchant/knowledge*` | manager |
| GET | `/api/merchant/analytics/ai` | manager |
| GET | `/api/merchant/stats` `/reports/*` | staff |
| GET | `/api/orders`、`GET /api/orders/:id` | staff |
| PUT | `/api/orders/:id/status` | staff |
| POST/PUT/DELETE | `/api/stores` `/inventory` `/suppliers` | manager |
| GET | `/api/deliveries` | staff |
| POST | `/api/qr` | manager |
| POST/GET | `/api/stripe/connect/*` `/api/square/connect/*` | owner |
| GET | `/api/usage` | owner |

错误格式：`{ error, code }`。
