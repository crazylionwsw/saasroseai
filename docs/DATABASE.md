# DATABASE — 数据库设计

金额一律整数 cents（列名 `*_cents`）。租户键 `merchant_id`。

## 中央 D1 (`central/schema.sql`)
| 表 | 用途 | 关键列 |
|---|---|---|
| `merchants` | 商户 | id, name, status, plan, subdomain, template_id, cf_account_id, cf_api_token, language, currency_symbol, custom_domain |
| `merchant_configs` | 商户密钥/配置 | merchant_id, drive_*, twilio_*, stripe_account_id |
| `merchant_tokens` | 商户 JWT 记录 | merchant_id, token_hash |
| `deployments` | 部署记录 | id, merchant_id, version, status, worker_url, pages_url |
| `templates` | 模板 | id, name, description, is_active, features |
| `audit_logs` | 审计日志 | id, action, target_type, target_id, detail, ip |

迁移：`central/migrations/001~006`。

## 商户 D1 (`merchant-template/worker/schema.sql`)
| 表 | 用途 | 关键列 |
|---|---|---|
| `merchant_info` | 商户资料（单行） | name, ..., menu_categories(JSON), tax_rate, drive_* |
| `orders` | 订单 | id, order_type, table_id, idempotency_key, items, subtotal/tax/tip/total_cents, status, payment_status |
| `payments` | 支付账本 | id, order_id, provider, provider_payment_id, amount_cents, status |
| `payment_events` | Webhook 幂等 | UNIQUE(provider, provider_event_id) |
| `refunds` | 退款 | payment_id, amount_cents, provider_refund_id |
| `payment_accounts` | Connect/OAuth 账户 | merchant_id, provider, provider_account_id, metadata |
| `carts` / `cart_items` | 服务端购物车 | cart_id, item_id, qty, modifiers |
| `tax_rules` | 税规则 | tax_code(GST/PST/HST), rate_bp |
| `staff_users` / `staff_sessions` | 员工与 RBAC 会话 | role, password_hash, token_hash |
| `chat_sessions` / `chat_messages` | AI 会话 | session_id, role, content |
| `knowledge_docs` / `knowledge_chunks` / `sync_log` | RAG 知识库 | drive_file_id, chunk_text |
| `call_records` / `call_transfers` / `call_conversation_archive` | 语音 | call_sid, summary |
| `analytics_events` | 事件/工具审计 | event_type, event_data |
| `stores` | 多门店 | name, phone, address |
| `inventory_items` / `suppliers` / `purchase_orders` | 库存/供应商 | stock, cost_price |
| `delivery_orders` | 配送 | platform, delivery_status, total_cents |

迁移：`merchant-template/worker/migrations/006~012`。

## 状态机
- Order：`draft → pending_payment → paid → confirmed → preparing → ready → completed`（可 `cancelled`；`refunded`）。
- Payment：`not_required/pending/processing/succeeded/failed/cancelled/refunded/partially_refunded`。
