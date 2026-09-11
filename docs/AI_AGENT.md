# AI_AGENT — AI 设计

## 原则
AI 不是事实来源。AI 只能通过 typed tool 调用域服务，禁止直接 SQL / 改价 / 改支付状态 / 访问支付密钥。

```
LLM → ToolRegistry → 参数校验 → Tenant Context(env.MERCHANT_ID) → Domain Service → D1
```

## 工具（`ai-tools.ts`）
| 工具 | 说明 | 复用域 |
|---|---|---|
| `search_menu` / `get_menu_item` | 菜单查询 | pricing.loadMenu |
| `create_cart` / `add_item` / `update_quantity` / `remove_item` / `calculate_cart` | 购物车 | cart |
| `create_order` / `get_order_status` / `cancel_order` | 订单 | order / order-state |
| `create_payment` / `get_payment_status` | 支付 | payment |

所有工具：typed 参数校验、租户绑定、写入 `analytics_events` 审计。

## 文本客服（`chat-do.ts`）
- WebSocket（`/ws`）→ `ChatRoom` DO。
- 普通问答：RAG（Vectorize topK=5，按 merchantId 过滤）+ Llama 3.1 8B。
- 点餐流程：意图识别 → 提取菜品 → `search_menu` → `create_cart`/`add_item`
  → `calculate_cart` → 用户确认 → `create_order` → `create_payment`（返回支付链接）。
- 人工接管：`switch_human` / `switch_ai`。

## 语音客服（`phone-do.ts`）
Twilio → `PhoneCall` DO：意图识别（query_menu/place_order/query_hours/query_address/
transfer_human/end_call）→ RAG → LLM → TTS；转人工 `<Dial>`；15 分钟超时。

## RAG 知识库（`knowledge-sync.ts`）
Google Drive（只读）→ 分块 → BGE embedding → Vectorize（metadata: merchantId/fileId）
→ `knowledge_docs`/`knowledge_chunks`。`scheduled()` cron 每 5 分钟增量同步。

## 安全约束
- 不得编造菜单/价格/营业时间。
- 不得声称未验证的支付成功。
- 工具失败返回结构化错误，不泄漏内部信息。
