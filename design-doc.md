# 餐饮门店在线智能服务体 — 系统设计文档

## 1. 项目概述

### 1.1 项目目标
构建一套 SaaS 平台，为餐饮门店提供以下功能的在线智能服务体：
- 官网宣传（模板化、自动生成）
- 在线订单
- 在线付款
- 智能客服（文本 + 语音电话）
- Google Drive 知识库驱动 AI 回复

### 1.2 核心原则
- 除第三方必要费用（Twilio 电话）外，全部使用免费服务
- 每个商户独立 Cloudflare 账户，享受独立免费额度
- 中央后台统一管控，商户零运维
- AI 使用 Cloudflare Workers AI（免费额度内），不引入外部 LLM API 成本

---

## 2. 系统架构

### 2.1 总体架构

```
┌────────────────────────────────────────────────────────────┐
│                    中央管控平台（你的 Cloudflare 账号）        │
│                                                           │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────────┐   │
│  │ Admin UI │  │ Auth API   │  │ 商户管理 API          │   │
│  │ (Pages)  │  │ (Workers)  │  │ (Workers + D1)       │   │
│  └──────────┘  └────────────┘  └──────────────────────┘   │
│                                                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │ D1 (central_db) — 商户表 / 部署记录 / Token / 日志  │   │
│  └────────────────────────────────────────────────────┘   │
└───────────────────────┬────────────────────────────────────┘
                        │ HTTPS + JWT 验证
                        ▼
┌────────────────────────────────────────────────────────────┐
│                 商户 A（独立 Cloudflare 账号）                │
│                                                           │
│  ┌──────────────────┐     ┌────────────────────────┐      │
│  │ Storefront Pages  │     │  API Worker            │      │
│  │ shop-a.平台.com   │     │  /api/* 路由           │      │
│  └──────────────────┘     └───────────┬────────────┘      │
│                                       │                    │
│        ┌──────────────────────────────┼──────────────┐    │
│        │           Durable Objects    │              │    │
│        │  ┌──────────┐  ┌──────────┐  │              │    │
│        │  │ Chat DO  │  │ Phone DO │  │              │    │
│        │  │ 客服会话  │  │ 电话会话  │  │              │    │
│        │  └──────────┘  └──────────┘  │              │    │
│        └──────────────────────────────┘              │    │
│                                                      │    │
│  ┌──────┐  ┌────────┐  ┌───────────┐  ┌──────────┐  │    │
│  │ D1   │  │ R2     │  │ Vectorize │  │ KV       │  │    │
│  │ 数据 │  │ 存储   │  │ 向量索引   │  │ 缓存/状态 │  │    │
│  └──────┘  └────────┘  └───────────┘  └──────────┘  │    │
└────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术 | 费用 |
|------|------|------|
| 前端框架 | Cloudflare Pages + 原生 JS（模板网站） | 免费 |
| 后台 UI | Cloudflare Pages + 任意前端框架 | 免费 |
| API 层 | Cloudflare Workers | 免费（10万请求/天/商户） |
| 数据库 | Cloudflare D1 (SQLite) | 免费（5GB/商户） |
| 对象存储 | Cloudflare R2 | 免费（10GB/商户） |
| 向量检索 | Cloudflare Vectorize | 免费（Beta） |
| 状态/缓存 | Cloudflare KV | 免费（1GB/商户） |
| AI | Cloudflare Workers AI | 免费（10k 神经元/天） |
| 实时通信 | Durable Objects + WebSocket | 免费 |
| 语音电话 | Twilio | ~$1/号/月 + $0.013/分钟 |
| 知识库存储 | Google Drive（商户已有） | 免费 |
| 地图/导航 | Google Maps 或 Leaflet（免费） | 免费 |

---

## 3. 商户官网生成系统

### 3.1 模板系统

每个模板为独立静态文件夹，存储在 R2：

```
templates/
├── classic/                    # 模板ID
│   ├── preview.png            # 预览图（商户选模板时展示）
│   ├── index.html             # 主页面（含占位符）
│   ├── menu.html              # 菜单页
│   ├── order.html             # 下单页
│   ├── contact.html           # 联系方式页
│   ├── style.css              # 样式
│   ├── app.js                 # 交互逻辑
│   └── config.json            # 模板元数据
├── modern/
│   └── ...
├── bubble-tea/
│   └── ...
└── japanese/
    └── ...
```

### 3.2 模板占位符规范

```html
<!-- index.html 示例 -->
<!DOCTYPE html>
<html>
<head>
  <title>{{RESTAURANT_NAME}} - {{RESTAURANT_SLOGAN}}</title>
  <meta name="description" content="{{RESTAURANT_DESC}}" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header style="background-color: {{PRIMARY_COLOR}}">
    <img src="{{LOGO_URL}}" alt="{{RESTAURANT_NAME}}" class="logo" />
    <h1>{{RESTAURANT_NAME}}</h1>
    <p>{{RESTAURANT_DESC}}</p>
  </header>

  <section id="featured">
    <h2>推荐菜品</h2>
    <div class="menu-grid">
      {{#each FEATURED_ITEMS}}
      <div class="menu-card" onclick="addToCart('{{id}}')">
        <img src="{{image}}" alt="{{name}}" />
        <h3>{{name}}</h3>
        <p>{{description}}</p>
        <span class="price">¥{{price}}</span>
      </div>
      {{/each}}
    </div>
  </section>

  <footer>
    <p>📍 {{ADDRESS}}</p>
    <p>📞 <a href="tel:{{PHONE}}">{{PHONE}}</a></p>
    <p>🕐 {{BUSINESS_HOURS}}</p>
  </footer>

  <script src="/app.js"></script>
  <script>
    // 自动注入的运行配置
    window.__MERCHANT_CONFIG__ = {
      id: '{{MERCHANT_ID}}',
      apiBase: 'https://{{MERCHANT_SUBDOMAIN}}.api.平台.com',
      wsUrl: 'wss://{{MERCHANT_SUBDOMAIN}}.ws.平台.com',
      payment: { /* 支付配置 */ },
      social: { /* 社交媒体链接 */ }
    }
  </script>
</body>
</html>
```

### 3.3 生成流水线

```
商户在后台提交信息
        │
        ▼
Worker 接收请求
        │
  1. 校验数据完整性
  2. 上传图片到 R2（商户独立桶）
  3. 获取商户信用信息
        │
        ▼
模板引擎渲染
  1. 从 R2 读取模板文件
  2. 注入商户数据（简单字符串替换）
  3. 动态生成菜单 JSON（前端 AJAX 用）
        │
        ▼
部署到 Pages
  1. 上传生成的文件到商户 Pages 项目
  2. 触发 Pages 部署
  3. 自定义域名绑定（可选）
        │
        ▼
返回店铺 URL
```

### 3.4 商户后台数据字段

```typescript
interface MerchantData {
  // 基本信息
  name: string
  slogan: string
  description: string
  logoUrl: string
  coverUrl: string
  primaryColor: string
  templateId: string

  // 联系方式
  phone: string
  address: string
  businessHours: string
  socialMedia: {
    wechat?: string
    weibo?: string
    douyin?: string
  }

  // 位置
  latitude?: number
  longitude?: number

  // 菜单
  menuCategories: MenuCategory[]
  featuredItems: string[]  // 推荐菜品 ID 列表

  // 配置
  enableOrdering: boolean
  enablePayment: boolean
  enableChat: boolean
  enablePhone: boolean
}

interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  image: string
  category: string
  tags: string[]
  isAvailable: boolean
  specifications?: { name: string; options: { label: string; priceDelta: number }[] }[]
}

interface MenuCategory {
  name: string
  items: MenuItem[]
}
```

---

## 4. 在线订单系统

### 4.1 数据流

```
顾客浏览菜单 → 添加购物车（前端 localStorage）
        │
        ▼
提交订单 → Worker /api/order/create
        │
  1. 验证库存
  2. 计算金额 + 配送费
  3. 生成订单号
  4. 存入 D1
        │
        ▼
返回订单 → 引导支付
        │
        ▼
支付完成 → Worker 处理回调
        │
  1. 更新订单状态
  2. 通知商户（Webhook / 短信）
  3. 通知顾客（页面 / 客服消息）
```

### 4.2 D1 订单表结构

```sql
CREATE TABLE orders (
  id TEXT PRIMARY KEY,              -- 订单号 (ORD-20260629-XXXXX)
  merchant_id TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  items TEXT NOT NULL,              -- JSON: [{itemId, name, qty, price, specs}]
  subtotal REAL NOT NULL,
  delivery_fee REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT DEFAULT 'pending',    -- pending | confirmed | preparing | delivering | completed | cancelled
  payment_status TEXT DEFAULT 'unpaid', -- unpaid | paid | refunded
  payment_method TEXT,              -- wechat | alipay | cash
  payment_id TEXT,                  -- 第三方支付流水号
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_orders_merchant ON orders(merchant_id, created_at DESC);
```

### 4.3 支付对接

支持渠道：

| 渠道 | 接入方式 | 费率 |
|------|---------|------|
| 微信支付 | 商户自行申请，平台提供 JSAPI 封装 | 0.6% |
| 支付宝 | 商户自行申请，平台提供 SDK 封装 | 0.6% |
| 货到付款 | 无需接入，平台记录 | 0% |
| 平台代收 | 平台申请聚合支付，商户扣点 | 可抽成 1-3% |

### 4.4 订单通知

- 商户后台：实时 WebSocket 推送
- STAFF 端：可选 Telegram Bot 通知（免费）
- 顾客端：页面状态轮询 / SSE

---

## 5. 智能客服系统（Chat）

### 5.1 架构

```
顾客打开客服 → WebSocket 连接 Chat DO
        │
        ▼
Chat DO 创建会话
  1. 加载商户知识库配置
  2. 加载最近对话历史
        │
        ▼
用户发消息 → Chat DO.onMessage()
        │
  1. 向量检索（→ Vectorize → Top 5 chunks）
  2. 组装 prompt（system + chunks + 历史 + 当前）
  3. Workers AI 生成回复（Llama 3）
  4. 回复用户
        │
        ▼
若人工客服模式：
  1. 客服后台 WebSocket 接收消息
  2. 客服输入回复
  3. Chat DO 转发给顾客
  4. 对话自动关闭 / 转回 AI
```

### 5.2 Chat DO 核心设计

```typescript
class ChatRoom extends DurableObject {
  private state: {
    merchantId: string
    customerId: string
    mode: 'ai' | 'human'
    assignedAgent?: string
    messages: Message[]
    context: { chunks: string[]; documents: string[] }
    knowledgeBaseId: string
    metadata: Record<string, any>
  }

  // RPC 方法
  async onMessage(msg: string): Promise<void> // 处理用户消息
  async switchToHuman(): Promise<void>         // 转人工
  async switchToAI(): Promise<void>            // 转回 AI
  async assignAgent(agentId: string): Promise<void> // 分配客服
  async resolve(): Promise<string>             // 关闭会话 + 生成摘要
  async getTranscript(): Promise<Message[]>    // 获取完整对话
}

interface Message {
  id: string
  role: 'customer' | 'ai' | 'agent' | 'system'
  content: string
  timestamp: number
  metadata?: {
    chunksUsed?: string[]
    confidence?: number
  }
}
```

### 5.3 RAG 回复生成

```typescript
async function generateReply(userMsg: string, env: Env): Promise<string> {
  // 1. 向量检索
  const embedding = await env.AI.run('@cf/baai/bge-small-en-v1.5', {
    text: [userMsg]
  })
  const results = await env.VECTORIZE.query(embedding.data[0], {
    topK: 5,
    filter: { merchantId: { eq: env.MERCHANT_ID } }
  })

  // 2. 组装 prompt
  const chunks = results.matches.map(m => m.metadata.text)
  const systemPrompt = `你是 ${env.RESTAURANT_NAME} 的 AI 客服。
  用以下资料回答顾客问题。资料不足时请说"我需要查一下再回复您"。
  不要编造信息。回答简洁自然。\n\n资料：\n${chunks.join('\n---\n')}`

  // 3. Workers AI 生成
  const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: systemPrompt },
      ...contextHistory,
      { role: 'user', content: userMsg }
    ],
    stream: false
  })

  return response
}
```

---

## 6. 智能电话系统（Phone）

### 6.1 呼叫流程

```
顾客拨打商户 Twilio 号码
        │
        ▼
Twilio Voice Webhook → POST → Worker
        │
        ▼
PhoneAgent DO 创建会话
        │
  1. 查询商户配置（营业状态、知识库）
  2. Twilio <Gather> 等待语音输入
        │
        ▼
用户说话 → Twilio 发录音 → Worker
        │
        ▼
Whisper STT（Workers AI）→ 转文字
        │
        ▼
意图识别（Llama 3）
  查询菜单 / 下单 / 营业时间 / 地址 / 转人工 / 其他
        │
        ▼
RAG 检索 → LLM 生成回答
        │
        ▼
TTS 合成（Workers AI）→ Twilio <Say> 播报
        │
        ▼
继续对话 / 转人工 / 挂断
```

### 6.2 Phone DO 核心设计

```typescript
class PhoneCall extends DurableObject {
  private state: {
    callSid: string               // Twilio 呼叫 SID
    merchantId: string
    customerNumber: string
    status: 'greeting' | 'listening' | 'processing' | 'speaking' | 'transferring' | 'ended'
    conversation: { role: string; text: string }[]
    knowledgeBaseId: string
    context: { chunks: string[]; documents: string[] }
    recordingUrl?: string         // R2 录音地址
    duration: number
  }

  async handleIncoming(callData: TwilioCallData): Promise<Twiml>   // 处理来电
  async processSpeech(transcript: string): Promise<void>           // 处理语音输入
  async transferToHuman(agentNumber: string): Promise<void>        // 转人工
  async endCall(): Promise<void>                                   // 挂断 + 生成摘要 + 存录音
}
```

### 6.3 Twilio Webhook 处理

```typescript
async function handleVoiceWebhook(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData()
  const callSid = formData.get('CallSid') as string
  const merchantId = formData.get('merchantId') as string

  // 获取或创建 Phone DO
  const doId = env.PHONE_CALL_DO.idFromName(callSid)
  const stub = env.PHONE_CALL_DO.get(doId)

  // 检查商户状态（中央认证）
  const merchantValid = await verifyMerchantStatus(merchantId, env)
  if (!merchantValid) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>您好，该商户服务已暂停，请联系平台客服。</Say>
        <Hangup/>
      </Response>`
    return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // 转发到 DO
  return stub.fetch(request)
}
```

### 6.4 对话示例

```
系统: 您好，欢迎致电XX餐厅。请问有什么可以帮您？
顾客: 你们今天营业到几点？
系统: （向量检索营业时间资料 → LLM 生成）我们营业到晚上10点，最后点单时间是9点半。
顾客: 我想点一份宫保鸡丁和两份米饭，送到幸福路16号。
系统: （RAG 检索菜单 → LLM 确认）好的，宫保鸡丁38元，米饭3元一份，共计44元。您的地址是幸福路16号，请问大概几点送到？
顾客: 现在送吧。
系统: 好的，已为您下单，预计30-40分钟送达。订单号是ORD-20260629-001。还有其他需要吗？
顾客: 没有了，谢谢。
系统: 感谢您的来电，祝您用餐愉快！
```

---

## 7. Google Drive 知识库

### 7.1 整体流程

```
商户授权 Google Drive（OAuth 2.0，只读权限）
        │
        ▼
Worker 定时任务（Cron Trigger，每 5 分钟）
  1. 遍历商户指定文件夹
  2. 比对变更（drive.changes.list）
        │
        ▼
新文件 / 变更文件 → 下载内容
        │
  1. PDF → pdf-parse 提取文本
  2. DOCX → 解析为纯文本
  3. Google Docs → Drive API export 为 TXT
  4. TXT → 直接读取
        │
        ▼
文本分块（512 tokens / 块，150 tokens 重叠）
        │
        ▼
生成 Embedding（Workers AI BGE）
        │
        ▼
存入 Vectorize（按商户隔离）
        │
        ▼
更新 D1 文件映射表
```

### 7.2 D1 知识库表

```sql
CREATE TABLE knowledge_docs (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,    -- Google Drive 文件 ID
  drive_file_name TEXT,
  drive_mime_type TEXT,
  drive_modified_at TEXT,
  synced_at TEXT,
  status TEXT DEFAULT 'active',   -- active | deleted | error
  chunk_count INTEGER DEFAULT 0
);

CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT REFERENCES knowledge_docs(id),
  chunk_index INTEGER,
  content TEXT NOT NULL,
  token_count INTEGER,
  vector_id TEXT                   -- Vectorize 中的向量 ID
);

CREATE TABLE sync_log (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  files_processed INTEGER,
  files_added INTEGER,
  files_updated INTEGER,
  files_deleted INTEGER,
  errors TEXT,
  status TEXT DEFAULT 'pending'
);
```

### 7.3 OAuth 流程

```
商户后台 → "连接 Google Drive"
        │
        ▼
跳转 Google OAuth 页（scope: drive.readonly）
        │
        ▼
商户授权 → 回调到 Worker
        │
  1. 交换 authorization code 为 access_token + refresh_token
  2. 加密存入 D1（商户配置表）
  3. 商户选择 Drive 中的文件夹
        │
        ▼
Worker 存储文件夹 ID → 开始首次同步
        │
        ▼
后续：refresh_token 自动续期，无需商户再次操作
```

### 7.4 增量同步

```typescript
async function syncDriveFiles(merchantId: string, env: Env): Promise<SyncResult> {
  const config = await getMerchantConfig(merchantId, env)
  const drive = new GoogleDriveClient(config.driveToken)

  // 获取变更（首次全量，之后增量）
  const changes = await drive.getChanges(config.driveFolderId, config.syncCursor)

  for (const change of changes) {
    if (change.removed) {
      await deleteFromIndex(change.fileId, merchantId, env)
      continue
    }

    // 下载并解析
    const text = await downloadAndExtract(drive, change.file)
    const chunks = splitIntoChunks(text, 512)

    // 删除旧向量
    await deleteVectorsForFile(change.fileId, merchantId, env)

    // 生成新向量并存储
    for (const [i, chunk] of chunks.entries()) {
      const embedding = await env.AI.run('@cf/baai/bge-small-en-v1.5', { text: [chunk] })
      await env.VECTORIZE.insert([{
        id: `${merchantId}:${change.fileId}:${i}`,
        values: embedding.data[0],
        metadata: {
          merchantId,
          fileId: change.fileId,
          fileName: change.file.name,
          chunkIndex: i,
          text: chunk
        }
      }])
    }
  }

  // 更新同步游标
  await saveSyncCursor(merchantId, changes.newCursor, env)
}
```

---

## 8. 中央管控平台

### 8.1 功能模块

| 模块 | 功能 |
|------|------|
| 商户管理 | 创建/编辑/冻结/删除商户 |
| 部署管理 | 执行部署脚本、查看部署状态、版本回滚 |
| 认证管理 | 签发/吊销商户 JWT Token |
| 监控面板 | 各商户资源使用量、请求量、错误率 |
| 模板管理 | 上传/编辑/下架网站模板 |
| 日志中心 | 聚合各商户运行日志 |

### 8.2 认证体系

```
商户注册 → 中央后台生成 merchant_id
        │
        ▼
自动签发 JWT（含 merchant_id, plan, exp）
        │
        ▼
部署时注入商户 Worker 环境变量
        │
        ▼
商户 Worker 每次启动/定时验证：
  GET {CENTRAL_AUTH_URL}/api/merchants/verify
  Header: Authorization: Bearer {MERCHANT_TOKEN}
        │
        ▼
中央 API 返回 { status: 'active' | 'frozen' | 'expired' }
        │
        ▼
商户 Worker 缓存结果 5 分钟，异常则 403 停服
```

### 8.3 中央数据库设计

```sql
CREATE TABLE merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT DEFAULT 'active',         -- active | frozen | expired | deleted
  plan TEXT DEFAULT 'basic',            -- basic | pro | enterprise
  cf_account_email TEXT,                -- 商户 Cloudflare 账号邮箱
  cf_account_id TEXT,                   -- 商户 Cloudflare 账号 ID
  subdomain TEXT UNIQUE,                -- shop-xxx.平台.com
  template_id TEXT,                     -- 当前使用的模板
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  notes TEXT
);

CREATE TABLE merchant_configs (
  merchant_id TEXT PRIMARY KEY REFERENCES merchants(id),
  drive_token_encrypted TEXT,           -- 加密存储的 Google Drive token
  drive_folder_id TEXT,
  twilio_phone_sid TEXT,
  twilio_auth_token_encrypted TEXT,
  stripe_account_id TEXT,
  wechat_merchant_id TEXT,
  alipay_merchant_id TEXT,
  custom_domain TEXT,
  ssl_status TEXT
);

CREATE TABLE merchant_tokens (
  merchant_id TEXT PRIMARY KEY REFERENCES merchants(id),
  token_hash TEXT NOT NULL,
  issued_at TEXT,
  expires_at TEXT,
  last_verified_at TEXT
);

CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  version TEXT NOT NULL,
  template_version TEXT,
  status TEXT DEFAULT 'pending',        -- pending | deploying | success | failed
  worker_url TEXT,
  pages_url TEXT,
  cf_deployment_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  error_log TEXT,
  deployed_by TEXT
);
```

---

## 9. 部署系统

### 9.1 部署脚本（deploy.sh）

```bash
#!/bin/bash
# deploy.sh — 为商户部署完整服务体到独立 Cloudflare 账号
# 用法: ./deploy.sh --merchant-id=xxx --cf-email=xxx --cf-api-key=xxx

set -e

# 解析参数
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --merchant-id) MERCHANT_ID="$2"; shift ;;
    --cf-email) CF_EMAIL="$2"; shift ;;
    --cf-api-key) CF_API_KEY="$2"; shift ;;
  esac
  shift
done

# 1. 切换到商户 CF 账号
export CLOUDFLARE_EMAIL="$CF_EMAIL"
export CLOUDFLARE_API_KEY="$CF_API_KEY"

# 2. 创建 D1 数据库
DB_NAME="restaurant-${MERCHANT_ID}"
npx wrangler d1 create "$DB_NAME" --output json > d1-output.json
DB_ID=$(jq -r '.id' d1-output.json)

# 3. 初始化 D1 表
npx wrangler d1 execute "$DB_NAME" --file ./schema.sql

# 4. 创建 R2 桶
npx wrangler r2 bucket create "assets-${MERCHANT_ID}"
npx wrangler r2 bucket create "recordings-${MERCHANT_ID}"

# 5. 创建 Vectorize 索引
npx wrangler vectorize create "knowledge-${MERCHANT_ID}" \
  --dimensions 384 --metric cosine

# 6. 创建 Pages 项目 + 部署模板网站
npx wrangler pages project create "storefront-${MERCHANT_ID}" \
  --production-branch main
# 首次部署空内容
echo "<html><body>Loading...</body></html>" > index.html
npx wrangler pages deploy . --project-name "storefront-${MERCHANT_ID}"

# 7. 部署 Worker
npx wrangler deploy \
  --name "api-${MERCHANT_ID}" \
  --compatibility-date "2025-04-01" \
  --d1 "DB=${DB_ID}" \
  --r2 "ASSETS=assets-${MERCHANT_ID}" \
  --r2 "RECORDINGS=recordings-${MERCHANT_ID}" \
  --vectorize "KNOWLEDGE=knowledge-${MERCHANT_ID}" \
  --route "*.${MERCHANT_ID}.api.平台.com/*"

# 8. 设置环境变量
echo "${CENTRAL_AUTH_URL}" | npx wrangler secret put CENTRAL_AUTH_URL
echo "${MERCHANT_TOKEN}" | npx wrangler secret put MERCHANT_TOKEN
echo "${MERCHANT_ID}" | npx wrangler secret put MERCHANT_ID
echo "${TWILIO_ACCOUNT_SID}" | npx wrangler secret put TWILIO_ACCOUNT_SID
echo "${TWILIO_AUTH_TOKEN}" | npx wrangler secret put TWILIO_AUTH_TOKEN
echo "${TWILIO_PHONE_NUMBER}" | npx wrangler secret put TWILIO_PHONE_NUMBER

# 9. 回注册到中央后台
curl -X POST "${CENTRAL_ADMIN_URL}/api/deployments" \
  -H "Authorization: Bearer ${ADMIN_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"merchantId\": \"${MERCHANT_ID}\",
    \"workerUrl\": \"https://api-${MERCHANT_ID}.your-worker.workers.dev\",
    \"pagesUrl\": \"https://storefront-${MERCHANT_ID}.pages.dev\",
    \"d1DbId\": \"${DB_ID}\"
  }"

echo "✅ 商户 ${MERCHANT_ID} 部署完成"
```

### 9.2 版本更新流程

```
中央后台 → 选择要更新的商户（批量/全量）
        │
        ▼
更新模板 / 代码 → 构建新版本
        │
        ▼
对每个目标商户：
  1. 调用对应 CF 账号 API Token
  2. 重新部署 Worker（保留环境变量）
  3. 重新部署 Pages
  4. 记录 deployment 日志
        │
        ▼
新旧版本切换（零停机）
```

---

## 10. 费用估算（月）

### 10.1 平台方成本（假设 20 商户）

| 项目 | 计算 | 月费 |
|------|------|------|
| Cloudflare Workers（中央后台） | 免费额度内 | $0 |
| Cloudflare D1（中央数据库） | 免费额度内 | $0 |
| Cloudflare Pages（中央后台 UI） | 免费 | $0 |
| 中央管控域名 | $10/年 | ~$1 |
| **总计** | | **~$1** |

### 10.2 每商户成本

| 项目 | 计算 | 月费 |
|------|------|------|
| Cloudflare Workers | 免费（10万请求/天） | $0 |
| Cloudflare D1 | 免费（5GB） | $0 |
| Cloudflare R2 | 免费（10GB） | $0 |
| Cloudflare Vectorize | 免费（Beta） | $0 |
| Cloudflare Workers AI | 免费（10k 神经元/天） | $0 |
| Cloudflare Pages | 免费 | $0 |
| **Twilio 号码** | $1/号 | **$1** |
| **Twilio 通话** | 假设 100分钟 × $0.013 | **$1.30** |
| **小计** | | **~$2.30** |

### 10.3 总成本

| 规模 | 月成本 | 主要支出 |
|------|--------|---------|
| 10 商户 | ~$24 | Twilio |
| 50 商户 | ~$116 | Twilio |
| 100 商户 | ~$231 | Twilio |
| 100 商户（仅文本客服） | ~$100 | 全部为 Twilio 号码月租 |

---

## 11. 目录结构

```
restaurant-saas/
├── central/                          # 中央管控平台
│   ├── admin-ui/                     # 后台前端（Pages）
│   ├── api/                          # 中央 API Worker
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── auth.ts               # JWT 签发/验证
│   │   │   ├── merchants.ts          # 商户 CRUD
│   │   │   ├── deployments.ts        # 部署管理
│   │   │   └── webhooks.ts           # 商户回调
│   │   └── wrangler.jsonc
│   ├── schema.sql                    # 中央 D1 建表
│   └── deploy.sh                     # 部署脚本
│
├── merchant-template/                # 商户端模板（每个商户一份）
│   ├── worker/
│   │   ├── src/
│   │   │   ├── index.ts              # 入口 + 认证校验
│   │   │   ├── storefront.ts         # 官网生成 API
│   │   │   ├── order.ts              # 订单系统
│   │   │   ├── payment.ts            # 支付对接
│   │   │   ├── chat-do.ts            # 智能客服 DO
│   │   │   ├── phone-do.ts           # 智能电话 DO
│   │   │   ├── knowledge-sync.ts     # Google Drive 同步
│   │   │   ├── rag.ts                # RAG 检索 + 生成
│   │   │   └── auth-middleware.ts     # 中央认证中间件
│   │   ├── schema.sql                # 商户 D1 建表
│   │   └── wrangler.jsonc
│   └── templates/                    # 网站模板
│       ├── classic/
│       ├── modern/
│       ├── bubble-tea/
│       └── japanese/
│
├── scripts/                          # 运维脚本
│   ├── deploy-merchant.sh            # 一键部署商户
│   ├── update-all.sh                 # 批量更新
│   └── verify-merchant.sh            # 验证商户状态
│
└── docs/
    └── architecture.md
```

---

## 12. 未来扩展

| 阶段 | 功能 |
|------|------|
| Phase 1 | 基础官网 + 在线菜单 + 在线下单（货到付款） |
| Phase 2 | 在线支付（微信/支付宝）+ 智能文本客服 |
| Phase 3 | Google Drive 知识库 + RAG + 智能电话 |
| Phase 4 | 商家后台 App、数据看板、营销工具（优惠券/满减） |
| Phase 5 | 多门店管理、聚合配送、供应链对接 |
| Phase 6 | 模板市场（开发者上传模板 + 分成） |

---

## 13. 附录

### 13.1 关键依赖

| 库/工具 | 用途 | 费用 |
|---------|------|------|
| googleapis | Google Drive API 客户端 | 免费 |
| pdf-parse | PDF 文本提取 | 免费 |
| mammoth | DOCX 文本提取 | 免费 |
| itty-router | Worker 路由 | 免费 |
| twilio | 语音电话 SDK | 按用量 |
| wrangler | Cloudflare CLI 部署 | 免费 |

### 13.2 Cloudflare 免费额度明细

| 服务 | 免费额度 |
|------|---------|
| Workers | 10万请求/天、1000 构建/月 |
| Workers AI | 10k 神经元/天 |
| D1 | 5GB 存储、500万行读取/月 |
| R2 | 10GB 存储、300万读/月 |
| Vectorize | Beta 期间免费 |
| KV | 1GB 存储、10万读取/天 |
| Pages | 无限带宽、500 构建/月 |
| Durable Objects | 100 个 DO/天、100万请求/月 |
