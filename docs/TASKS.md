# TASKS — 任务清单状态

| TASK | 说明 | 状态 |
|---|---|---|
| 000 | 项目规范与文档 | ✅ |
| 001 | 仓库引导 | ✅ |
| 002 | Cloudflare 基础设施 | ✅ |
| 003 | 数据库基础（tenants/users/restaurants） | ✅（商户 `staff_users` + 每商户独立库） |
| 004 | 租户隔离 | ✅ |
| 005 | 认证与授权（RBAC） | ✅（owner/manager/staff） |
| 006 | 餐厅资料 | ✅ |
| 007 | 菜单分类 | ✅ |
| 008 | 菜品 | ✅ |
| 009 | 规格/Modifier | ✅ |
| 010 | 菜单元数据 | ✅ |
| 011 | Cart 域 | ✅ |
| 012 | Pricing 引擎 | ✅ |
| 013 | Tax 引擎 | ✅ |
| 014 | Tip 引擎 | ✅ |
| 015 | Cart API | ✅ |
| 016 | Order 域 | ✅ |
| 017 | Order 状态机 | ✅ |
| 018 | Payment 状态机 | ✅ |
| 019 | Order API | ✅ |
| 020 | 幂等 | ✅ |
| 021 | 模板引擎 | ✅ |
| 022 | 网站运行时 | ✅ |
| 023 | 响应式 UI | ✅ |
| 024 | 网站构建器 | ✅（字段编辑） |
| 025 | SEO | ✅ |
| 026 | QR 点餐 | ✅ |
| 027 | 商户后台壳 | ✅ |
| 028 | 菜单管理 UI | ✅ |
| 029 | 订单管理 UI | ✅ |
| 030 | 实时订单通知 | ✅ |
| 031 | 餐厅设置 | ✅ |
| 032 | Payment 域 | ✅ |
| 033 | Payment 数据库 | ✅ |
| 034 | Stripe Connect | ✅ |
| 035 | Stripe Checkout | ✅ |
| 036 | Stripe Webhook | ✅ |
| 037 | Square OAuth | ✅ |
| 038 | Square Payment | ✅ |
| 039 | Square Webhook | ✅ |
| 040 | AI Chat Session | ✅ |
| 041 | RAG Pipeline | ✅ |
| 042 | RAG 检索租户过滤 | ✅ |
| 043 | AI 餐厅助手 | ✅ |
| 044 | AI Tool 框架 | ✅ |
| 045 | AI Menu Tools | ✅ |
| 046 | AI Cart Tools | ✅ |
| 047 | AI Order Tools | ✅ |
| 048 | AI Payment Tools | ✅ |
| 049 | AI Order E2E | ✅ |
| 050 | 平台后台（含审计） | ✅ |
| 051-055 | 采集/生成/R2/部署/历史 | ✅ |
| 056 | Google Drive 同步 | ✅（代码完成，需 Google 凭据） |
| 057 | AI 会话分析 | ✅ |
| 058 | 用量计量 | ✅ |
| 059 | 计费/升级 | ✅（套餐限额） |
| 060 | 多门店 | ✅ |
| 061 | 高级分析 | ✅ |
| 062 | 自定义域名 | ✅ |
| 063 | 语音 AI | ✅ |
| 064 | 配送集成 | ✅ |

## Definition of Done
TypeScript 通过 · 单元/集成测试通过 · 租户隔离验证 · 安全审查 · 无密钥入库 · 迁移可执行 · API 文档化。
