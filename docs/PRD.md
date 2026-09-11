# PRD — 产品需求

## 目标用户
加拿大中小餐厅（中餐、快餐、奶茶等），需要低成本数字化：官网 + 在线点餐 + 支付 + AI 客服。

## 核心价值
- 零运维：全 Cloudflare Serverless，商户无需自建服务器。
- 低成本：免费额度内运行，仅支付渠道与电话产生费用。
- 智能：AI 文本/语音客服 + AI 对话下单 + RAG 知识库。

## 核心闭环
```
Restaurant → Website / QR → Menu → Cart → Pricing / Tax / Tip
→ Order → Payment → Webhook → PAID → Merchant Dashboard
```

## 角色
| 角色 | 权限 |
|---|---|
| PLATFORM_ADMIN | 平台中央管理（商户/模板/部署/审计） |
| MERCHANT_OWNER | 商户全部功能 + 员工管理 |
| MANAGER | 订单/菜单/报表/设置 |
| STAFF | 订单处理 |
| CUSTOMER | 浏览/下单/支付（无需登录） |

## 功能范围
- 官网模板（classic / modern）+ SEO + 多语言（zh/en/fr）
- 在线点餐、QR 桌码点餐（堂食/自取）
- 购物车、服务端定价、GST/PST/HST 税、小费
- Stripe（含 Connect）/ Square 支付 + 验签 Webhook + 幂等
- 商户后台：订单、菜单、设置、门店、库存、供应商、配送、分析
- AI 文本客服（RAG + 工具下单）、语音客服（Twilio）
- 平台后台：商户管理、模板采集/市场、部署、审计日志

## 非目标
- 不自建支付通道；不存储卡信息；不做外卖平台深度对接（预留）。
