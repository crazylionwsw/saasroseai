# Rose SaaS — 餐厅独立站平台

为餐厅提供一站式数字化解决方案：官网模板、在线点餐、支付、AI 智能客服（文字+语音）、知识库 RAG。

## 架构概览

```
┌──────────────┐   ┌──────────────────┐
│   Admin UI   │   │  Central API     │
│  (Pages)     │──▶│  (Workers + D1)  │
└──────────────┘   └──────┬───────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
     ┌────────────────┐     ┌──────────────────┐
     │ Merchant 1      │     │ Merchant N       │
     │ (Worker + D1    │     │ (Worker + D1     │
     │  + R2 + DO)     │     │  + R2 + DO)      │
     └────────────────┘     └──────────────────┘
```

- **两层架构**：中央管理平台 + 独立商户 Worker
- **多账户隔离**：每个商户可部署到独立 Cloudflare 账户
- **全免费栈**：基于 Cloudflare Workers/D1/R2/Vectorize/AI 免费额度

## 技术栈

| 层 | 技术 |
|---|---|
| API 框架 | itty-router |
| 数据库 | Cloudflare D1 (SQLite) |
| 存储 | Cloudflare R2 (对象存储) |
| AI | Workers AI (Llama 3.1 8B + BGE Embedding) |
| 向量检索 | Cloudflare Vectorize |
| 实时通信 | WebSocket (Durable Objects) |
| 语音 | Twilio + Workers AI STT/TTS |
| 前端 | 原生 HTML/CSS/JS (Cloudflare Pages) |
| 部署 | wrangler CLI |

## 项目结构

```
rose-saas/
├── central/                    # 中央管理平台
│   ├── api/                    #   API Worker（商户CRUD、认证、部署、模板采集）
│   │   └── src/
│   │       ├── index.ts        #   路由、认证中间件
│   │       ├── auth.ts         #   JWT 生成/验证
│   │       ├── merchants.ts    #   商户管理 API
│   │       ├── deployments.ts  #   部署管理 API
│   │       ├── template-scraper.ts  # 网站采集转模板
│   │       ├── security.ts     #   限速、输入校验、审计日志
│   │       └── types.ts        #   类型定义
│   ├── admin-ui/               #   Admin SPA
│   │   └── src/                #   HTML + CSS + JS
│   ├── migrations/             #   D1 迁移脚本
│   └── schema.sql              #   完整建表 SQL
├── merchant-template/          # 商户 Worker 模板
│   ├── worker/src/
│   │   ├── index.ts            #   入口 + 路由
│   │   ├── storefront.ts       #   官网生成
│   │   ├── order.ts            #   订单管理
│   │   ├── payment.ts          #   支付集成
│   │   ├── chat-do.ts          #   智能客服 DO
│   │   ├── phone-do.ts         #   语音客服 DO
│   │   ├── rag.ts              #   RAG 问答
│   │   ├── knowledge-sync.ts   #   Google Drive 知识库同步
│   │   ├── auth-middleware.ts  #   商户认证
│   │   ├── utils.ts            #   工具函数
│   │   └── types.ts            #   类型定义
│   └── templates/              #    官网模板（classic / modern）
├── scripts/
│   ├── deploy-merchant.sh      #   商户一键部署
│   └── update-all.sh           #   批量更新商户
├── tests/                      #   测试（Vitest，24 tests）
└── design-doc.md               #   设计文档
```

## 快速开始

### 前置要求

- Node.js 18+
- Cloudflare 账户
- wrangler CLI

### 安装

```bash
npm install
```

### 本地开发

```bash
# 中央 API
npx wrangler dev --config central/api/wrangler.jsonc

# Admin UI
npx wrangler pages dev central/admin-ui/src
```

### 部署

```bash
# 中央 API
npx wrangler deploy --config central/api/wrangler.jsonc

# Admin UI
npx wrangler pages deploy central/admin-ui/src --project-name rose-saas-admin --branch main

# 数据库迁移
npx wrangler d1 execute rose-saas-central --file central/migrations/001_add_audit_logs.sql --remote
```

### 商户部署

```bash
# 一键部署商户到独立账户
./scripts/deploy-merchant.sh <merchant-id> <cf-email> <cf-api-key>
```

## 安全

- 登录：定时安全比较 + 限速（5次/分钟）+ 审计日志
- API：JWT 会话令牌（1-30天）+ Master Token 双认证
- 错误信息：不泄漏内部细节
- SQL：全参数化查询 + 列名白名单
- 响应头：X-Content-Type-Options、X-Frame-Options 等安全头
- CSRF：X-Requested-With 头校验

## 测试

```bash
npx vitest run --config tests/vitest.config.ts
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | JWT 签名密钥 |
| `ADMIN_API_TOKEN` | 管理员 Master Token |
| `CENTRAL_DB` | D1 数据库绑定 |
| `TEMPLATES_R2` | R2 模板存储桶 |
| `AI` | Workers AI 绑定 |

## License

MIT
