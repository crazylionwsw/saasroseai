# 产品需求规格说明书

**RoseAI Essential — 加拿大中小餐厅一站式数字化解决方案**

| 文档版本 | V3.0 |
|---------|------|
| 更新日期 | 2026-07-14 |
| 文档状态 | 初稿 |
| 密级 | 内部 |

---

## 目录

1. [引言](#1-引言)
2. [产品体系](#2-产品体系)
3. [定价策略](#3-定价策略)
4. [功能需求](#4-功能需求)
5. [用户端功能](#5-用户端功能)
6. [工作流程](#6-工作流程)
7. [非功能需求](#7-非功能需求)
8. [数据设计](#8-数据设计)
9. [API 设计](#9-api-设计)
10. [部署架构](#10-部署架构)
11. [成本估算](#11-成本估算)
12. [未来规划](#12-未来规划)

---

## 1. 引言

### 1.1 项目背景

加拿大中小餐饮门店普遍缺乏数字化能力：没有官方网站、没有在线下单系统、没有智能客服。现有市场方案费用高昂：

| 服务类型 | 市场价（CAD） | 收费模式 |
|---------|--------------|---------|
| 餐厅网站建站 | $1,250 - $10,000 | 一次性 |
| AI 聊天机器人 | $29 - $299/月 | 月费订阅 |
| 在线点餐系统 | $15 - $200/月 + 安装费 | 月费订阅 |
| 外卖平台 | 25-30% | 每单抽成 |

本项目利用 Cloudflare 免费服务套件，为餐饮门店提供一次性付费的数字化解决方案，涵盖官网建站、扫码点餐、AI 智能客服、知识库检索、支付集成等功能。商户无需承担月费，仅需向第三方服务商支付标准费用。

### 1.2 项目目标

- 为加拿大中小餐厅提供定制化专业网站（响应式、中英双语）
- 通过扫码点餐提升顾客体验和翻台率
- 通过 AI 智能客服降低人力成本
- 提供员工后台管理订单、菜单、顾客消息
- 支持 Stripe/Square 在线支付
- 商户零运维，基础设施由中央平台统一管理
- 一次性建设费用，无月度订阅

### 1.3 适用范围

本文档涵盖 RoseAI Essential 平台的全部功能需求。适用对象包括产品团队、开发团队、测试团队及项目干系人。

### 1.4 术语

| 术语 | 说明 |
|------|------|
| Essential | 产品线名称，意为"基础必备" |
| Basic | 基础版（网站 + 扫码点餐 + 员工后台） |
| Standard | 标准版（Basic + AI 聊天 + RAG） |
| Premium | 高级版（Standard + 支付集成） |
| Custom | 定制版（按需开发） |
| 扫码点餐 | 顾客扫描桌上二维码在手机上下单 |
| 员工后台 | 商户管理订单、菜单、消息的面板 |
| 中央管控平台 | 运营方管理所有商户的后台系统 |
| RAG | 检索增强生成，从知识库检索相关内容后生成回答 |
| DO | Cloudflare Durable Object，有状态对象 |
| D1 | Cloudflare 的 SQLite 兼容数据库 |
| R2 | Cloudflare 的对象存储服务 |
| Vectorize | Cloudflare 的向量检索服务 |
| Workers AI | Cloudflare 的 AI 推理服务 |
| Pages | Cloudflare 的静态网站托管服务 |
| STT | 语音转文字 |
| TTS | 文字转语音 |

---

## 2. 产品体系

### 2.1 Essential Basic — 基础版

**价格：$1,980 CAD（一次性）**

为餐厅打造定制网站，包含在线菜单展示、扫码点餐、员工后台。适合需要品牌官网和数字化点餐的传统餐厅。

**包含功能：**
- 定制响应式网站（中英双语）
- 品牌形象展示（Logo、标语、描述、图片）
- 在线菜单展示（分类、图片、价格）
- 扫码点餐（顾客扫码 → 手机浏览 → 下单）
- 员工后台管理面板（订单管理、菜单编辑、消息查看）
- 联系方式页（电话、地址、营业时间、社交媒体）
- 嵌入 Google 地图
- 独立子域名部署
- Cloudflare 全球 CDN 加速
- 员工培训一次

交付周期：3-5 个工作日

### 2.2 Essential Standard — 标准版

**价格：$4,980 CAD（一次性）**

包含 Basic 全部功能，外加 AI 聊天机器人和 RAG 知识库。适合客流量大、希望降低人工成本的中型餐厅。

**包含功能：**
- Basic 全部功能
- AI 智能聊天机器人（7×24 自动回复）
- RAG 知识库（上传 PDF/Word/TXT 文档）
- Google Drive 知识库自动同步
- 对话历史记录与分析
- 向量检索增强生成

交付周期：5-7 个工作日

### 2.3 Essential Premium — 高级版

**价格：$9,800 CAD（一次性）**

包含 Standard 全部功能，外加 Stripe/Square 支付集成。AI 可在对话中引导顾客完成下单和支付。适合希望全面数字化转型的餐厅。

**包含功能：**
- Standard 全部功能
- Stripe 支付集成（2.9% + $0.30/笔）
- Square 支付集成（2.6% + $0.10/笔）
- AI 对话引导下单与支付
- 自动计算金额与支付链接生成
- 支付状态实时回调与订单同步
- 多币种支持（CAD/USD）

交付周期：7-10 个工作日

### 2.4 Custom — 定制版

**价格：$19,800 CAD 起（单独报价）**

根据企业需求定制开发，包含全部功能并提供日常维护。适合连锁品牌、多门店管理、有特殊业务流程的企业。

交付周期：按需协商

### 2.5 可选增值服务

| 服务 | 价格 | 说明 |
|------|------|------|
| AI 语音电话客服（Twilio） | $980 | 一次性部署 |
| 自有域名绑定 | $380 | 替代默认子域名 |
| 高级模板定制 | $2,980+ | 按品牌 VI 定制模板 |
| 年度系统维护 | $800-1,500/年 | 安全更新、备份、支持 |

---

## 3. 定价策略

### 3.1 一次性收费模式

所有定价均为一次性系统建设与部署服务费，而非月费订阅。理由如下：

- 商户月度运营成本极低（$0-0.50/月），无需通过月费摊销基础设施
- 加拿大小企业主更偏好一次性支出而非持续承诺
- 竞品 AI 聊天月费 $29-299，我们的一次性费用相当于其 6-12 个月的支出，但提供永久所有权

### 3.2 第三方费用

商户需自行向第三方服务商支付以下费用，我们不加价：

| 项目 | 金额 | 说明 |
|------|------|------|
| 域名续费 | ~$15/年 | .ca 或 .com |
| 网站托管（首年后） | ~$99/年 | Cloudflare Pages |
| Stripe 手续费 | 2.9% + $0.30/笔 | Premium |
| Square 手续费 | 2.6% + $0.10/笔 | Premium |
| AI Token 费用 | ~$0.30-0.50/月 | Standard/Premium |
| Twilio 语音（可选） | ~$2.50/月 | 月租 + 通话费 |

### 3.3 升级路径

| 升档 | 补差价 |
|------|--------|
| Basic → Standard | $3,000 |
| Standard → Premium | $4,820 |
| Basic → Premium | $7,820 |
| 任意 → Custom | 单独报价 |

数据和配置完整保留，无需迁移。

---

## 4. 功能需求

### 4.1 定制网站

为每家餐厅量身打造专业、适配手机的响应式网站。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 品牌展示 | Logo、名称、标语、描述 | P0 |
| 响应式设计 | 桌面/平板/手机自适应 | P0 |
| 在线菜单 | 分类展示菜品，含图片、价格、描述 | P0 |
| 图片画廊 | 餐厅环境、菜品图片 | P1 |
| 营业信息 | 电话、地址、营业时间、邮箱 | P0 |
| 嵌入地图 | Google 地图显示位置 | P1 |
| 社交链接 | Facebook、Instagram、微信、抖音、小红书 | P1 |
| 中英双语 | 网站内容可切换中英文 | P0 |
| 自定义配色 | 匹配品牌主色调 | P0 |
| 模板渲染 | 使用占位符替换商户数据 | P0 |

### 4.2 扫码点餐

顾客扫描桌上二维码即可在手机浏览器中浏览菜单并直接下单。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 二维码生成 | 每桌独立二维码指向点餐页 | P0 |
| 菜单浏览 | 手机端按分类浏览 | P0 |
| 购物车 | 添加/删除菜品，实时计算总价 | P0 |
| 提交订单 | 填写姓名、电话后提交 | P0 |
| 订单通知 | 提交后推送至员工后台 | P1 |
| 状态跟踪 | 已确认/准备中/已完成 | P1 |

### 4.3 员工后台管理面板

提供给餐厅员工使用的管理后台，桌面端为主，支持移动端。

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 订单管理 | 查看、确认、完成、取消订单 | P0 |
| 实时更新 | 新订单自动刷新或提示 | P1 |
| 菜单管理 | 添加/编辑/删除菜品、分类、价格 | P0 |
| 上下架 | 随时启用或停用菜品 | P1 |
| 消息查看 | 查看 AI 客服对话历史 | P1 |
| 数据统计 | 订单数量、金额等基础统计 | P2 |
| 双语界面 | 中/英文切换 | P0 |
| 员工权限 | 管理者和员工不同权限 | P2 |

### 4.4 中央管控平台（Admin）

运营方管理所有商户的系统后台，部署于 Cloudflare Pages。

#### 4.4.1 认证与登录

| 功能 | 说明 | 优先级 |
|------|------|--------|
| Token 输入 | 密码式输入框输入 Admin Token | P0 |
| Session 有效期 | 可配置 1/3/7/14/30 天 | P0 |
| 速率限制 | 登录接口 5 次/分钟/IP | P0 |
| 审计日志 | 记录登录成功/失败 | P0 |
| 自动登出 | Token 过期后清除并跳转登录页 | P0 |

#### 4.4.2 仪表盘

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 商户总数 | 不含已删除的商户 | P0 |
| 活跃商户数 | 状态为 active 的商户 | P0 |
| 套餐分布 | 按 Basic/Standard/Premium/Custom 显示 | P1 |
| 部署统计 | 总部署记录数 | P1 |

#### 4.4.3 商户管理

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 商户列表 | 分页展示名称、子域名、套餐、状态、创建时间 | P0 |
| 搜索筛选 | 按名称/子域名搜索，按套餐/状态筛选 | P0 |
| 新增商户 | 名称、电话、邮箱、套餐、模板、CF 配置 | P0 |
| 编辑商户 | 修改全部商户信息 | P0 |
| 商户详情 | 基本信息、Token、部署历史、统计 | P0 |
| 冻结/激活 | 切换状态控制服务可用性 | P0 |
| 软删除 | 标记删除而非物理删除 | P0 |
| CF 配置 | Account ID + API Token 掩码显示 | P0 |
| 站点访问 | 子域名可点击直达 | P0 |
| 重新生成 Token | 签发新的商户 JWT Token | P0 |
| 触发部署 | 调用 CF 直连部署 | P1 |

#### 4.4.4 模板管理

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 模板列表 | 含 ID、名称、类型、状态 | P0 |
| 内置模板 | classic、modern 两个内置模板 | P0 |
| 采集模板 | 通过网站采集生成的模板 | P0 |
| 启用/停用 | 控制模板可用状态 | P1 |

#### 4.4.5 网站采集

从指定餐厅 URL 自动抓取内容并生成网站模板。

采集流程：
1. 管理员输入餐厅网站 URL
2. 自动抓取首页及内页（最多 8 页）
3. 正则提取：名称、电话、邮箱、地址、营业时间、描述、标语、社交链接
4. 从 HTML/CSS 提取主色调
5. 识别菜单页面提取菜品和价格
6. 生成模板文件（index.html, menu.html, contact.html, style.css）
7. 模板存入 R2，信息注册到 D1

| 功能 | 说明 | 优先级 |
|------|------|--------|
| URL 输入 | 管理员输入餐厅官网地址 | P0 |
| 自动抓取 | 抓取主页及内页 | P0 |
| 信息提取 | 正则提取关键信息 | P0 |
| 模板生成 | 含占位符的模板文件 | P0 |
| R2 存储 | 持久化存储 | P0 |
| D1 注册 | 写入数据库 | P0 |
| 速率限制 | 3 次/分钟/IP | P0 |
| 任务列表 | 查看已完成任务 | P1 |

#### 4.4.6 CF 直连部署

使用商户的 Cloudflare API Token，通过 Pages Direct Upload API 将网站部署到商户 CF 账号。

流程：
1. 读取商户 CF 配置
2. 从 R2 读取模板文件
3. 替换占位符为商户数据
4. 检查/创建 Pages 项目
5. Direct Upload 创建部署
6. 上传文件到预签名 URL
7. 记录部署结果

| 功能 | 优先级 |
|------|--------|
| 读取 CF 配置 | P0 |
| 模板渲染（替换所有变量） | P0 |
| Pages 项目创建 | P0 |
| Direct Upload | P0 |
| 部署记录 | P0 |
| 错误处理 | P0 |

#### 4.4.7 部署管理

| 功能 | 优先级 |
|------|--------|
| 创建部署记录（版本号、状态、时间） | P0 |
| 部署历史列表（按商户） | P0 |
| 状态更新（pending → deploying → success/failed） | P0 |
| URL 记录 | P1 |

#### 4.4.8 系统设置

| 功能 | 优先级 |
|------|--------|
| Session 有效期配置（1/3/7/14/30 天） | P0 |
| 自动重新登录 | P0 |

### 4.5 模板系统

每个模板为独立静态文件夹，存储在 R2，使用占位符替换商户数据。

```
templates/
├── classic/
│   ├── index.html
│   ├── menu.html
│   ├── order.html
│   ├── contact.html
│   ├── style.css
│   └── app.js
├── modern/
│   └── ...
└── tpl-xxxx/          # 采集生成的模板
    └── ...
```

**模板占位符：**

| 占位符 | 说明 | 来源 |
|--------|------|------|
| `{{RESTAURANT_NAME}}` | 餐厅名称 | 商户信息 |
| `{{RESTAURANT_SLOGAN}}` | 标语 | 商户 |
| `{{RESTAURANT_DESC}}` | 详细描述 | 商户 |
| `{{RESTAURANT_DESC_SHORT}}` | 简短描述 | 自动截取 |
| `{{PHONE}}` | 电话 | 商户 |
| `{{EMAIL}}` | 邮箱 | 商户 |
| `{{ADDRESS}}` | 地址 | 商户 |
| `{{BUSINESS_HOURS}}` | 营业时间 | 商户 |
| `{{LOGO_URL}}` | Logo 图片 URL | 商户 |
| `{{COVER_URL}}` | 封面图片 URL | 商户 |
| `{{YEAR}}` | 当前年份 | 自动生成 |
| `{{WECHAT_URL}}` | 微信 | 商户 |
| `{{DOUYIN_URL}}` | 抖音/TikTok | 商户 |
| `{{XIAOHONGSHU_URL}}` | 小红书 | 商户 |

### 4.6 AI 智能客服系统（Chat）

基于 WebSocket + Durable Object 的 AI 客服系统，支持 RAG 知识库检索。

**核心流程：**
1. 顾客通过 WebSocket 连接 Chat DO
2. 发送消息后 DO 接收
3. 向量检索：BGE Small 生成嵌入，Vectorize 检索 Top 5 片段
4. 组装提示词：系统提示 + 检索片段 + 对话历史 + 用户消息
5. LLM 生成回复（Workers AI Llama 3.1 8B）
6. 回复推送给顾客
7. 支持转人工模式

| 功能 | 优先级 |
|------|--------|
| WebSocket 连接 | P0 |
| AI 自动回复（RAG + LLM） | P0 |
| RAG 知识库检索 | P0 |
| 对话上下文保持（DO 内存） | P0 |
| 转人工 | P1 |
| 会话摘要生成 | P2 |
| 对话历史持久化到 D1 | P0 |

### 4.7 AI 智能电话系统（Phone）

基于 Twilio Voice + Workers AI 的智能语音电话系统（可选增值服务）。

**呼叫流程：**
1. 顾客拨打商户 Twilio 号码
2. Twilio Webhook 通知 Phone DO
3. DO 查询营业状态和知识库配置
4. Twilio 等待语音输入
5. 语音转文字（Whisper STT）
6. 意图识别（7 类）
7. RAG 检索 + LLM 生成回答
8. 文字转语音播报
9. 继续对话或挂断

| 功能 | 优先级 |
|------|--------|
| 来电接听（Twilio Webhook） | P0 |
| 语音识别（Whisper STT） | P0 |
| 意图识别（7 类） | P0 |
| RAG + LLM 回复 | P0 |
| 语音合成（TTS） | P0 |
| 转人工 | P1 |
| 录音存储（R2） | P2 |
| 对话摘要 | P2 |

### 4.8 订单系统

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 菜单浏览 | 按分类展示菜品 | P0 |
| 购物车 | 前端管理，实时计算 | P0 |
| 提交订单 | POST /api/order/create | P0 |
| 订单状态流 | pending → confirmed → preparing → completed / cancelled | P0 |
| 订单通知 | 员工后台实时显示 | P1 |
| 订单历史 | 按日期/状态查询 | P1 |

### 4.9 支付系统

| 功能 | 说明 | 优先级 |
|------|------|--------|
| Stripe 支付 | Payment Intent API，信用卡/数字钱包 | P0（Premium） |
| Square 支付 | Payments API | P1（Premium） |
| 支付回调 | 更新订单状态 | P0 |
| 支付状态查询 | 查询订单支付状态 | P0 |
| 货到付款 | 平台记录 | P1 |

### 4.10 Google Drive 知识库

商户授权 Google Drive 后，系统自动同步指定文件夹中的文档，解析后向量化存入 Vectorize。

**流程：**
1. OAuth 2.0 授权（只读）
2. 选择同步文件夹
3. Cron 触发器每 5 分钟检查变更
4. 检测到新文件或变更后下载解析
5. 文本分块（512 tokens/块，150 tokens 重叠）
6. BGE Small 生成嵌入向量
7. 存入 Vectorize（按商户隔离）
8. 更新文件映射表和同步日志

| 功能 | 优先级 |
|------|--------|
| OAuth 授权 | P1 |
| 文件夹选择 | P1 |
| 文件解析（PDF/DOCX/TXT/Google Docs） | P1 |
| 增量同步 | P1 |
| 向量化 + 向量存储 | P1 |
| 同步日志 | P2 |

---

## 5. 用户端功能

### 5.1 顾客端

| 功能 | 说明 | 适用版本 |
|------|------|---------|
| 浏览官网 | 品牌展示、菜单、联系信息 | 全部 |
| 扫码点餐 | 扫描二维码 → 手机菜单 → 下单 | 全部 |
| AI 在线咨询 | WebSocket 聊天机器人 | Standard+ |
| 在线支付 | 信用卡/数字钱包 | Premium |
| 电话咨询（AI） | AI 语音接听 | 可选 |

### 5.2 商户端

| 功能 | 说明 | 适用版本 |
|------|------|---------|
| 员工后台 | 订单管理、菜单管理、消息查看 | 全部 |
| 菜单更新 | 自行编辑菜品、价格、图片 | 全部 |
| 知识库管理 | 上传文档、配置知识源 | Standard+ |
| 支付配置 | Stripe/Square 账号绑定 | Premium |

### 5.3 平台管理端

| 功能 | 说明 |
|------|------|
| 商户管理 | 增删改查、状态控制、CF 配置 |
| 模板管理 | 内置/采集模板管理 |
| 网站采集 | URL 抓取生成模板 |
| CF 部署 | 直连部署商户 Pages |
| 部署历史 | 版本跟踪 |

---

## 6. 工作流程

从咨询到上线的完整流程：

### 第一步：需求咨询
- 上门拜访餐厅，了解业务流程
- 推荐合适的套餐方案
- 确认开发范围和交付时间

### 第二步：开发部署
- 定制网站开发（3-5 个工作日）
- AI 训练和测试（Standard 额外 2-3 天）
- 支付集成联调（Premium 额外 2-3 天）

### 第三步：上线与培训
- 发布网站、配置二维码
- 培训员工使用后台
- 验收确认

### 第四步：持续支持
- 系统维护和更新
- 按需内容修改
- 年度托管续费提醒

---

## 7. 非功能需求

### 7.1 安全性

| 需求 | 实现方式 | 优先级 |
|------|----------|--------|
| 口令安全 | 时序安全比较，防时序攻击 | P0 |
| 速率限制 | 登录 5 次/分钟，敏感操作 20 次/分钟，采集 3 次/分钟 | P0 |
| 错误信息脱敏 | 不泄露 SQL、内部路径 | P0 |
| SQL 注入防护 | 参数化查询 | P0 |
| CORS 限制 | 只允许已知来源 | P0 |
| 安全响应头 | X-Content-Type-Options, X-Frame-Options | P0 |
| CSRF 防护 | X-Requested-With 校验 | P0 |
| XSS 防护 | HTML 过滤 + 输出编码 | P0 |
| Token 掩码 | API Token 只显示首尾 4 位 | P0 |
| API 认证 | 除公开接口外均需 Bearer Token | P0 |
| 审计日志 | 所有管理操作记录 | P0 |
| 加拿大数据托管 | 数据存储在加拿大境内 | P1 |
| PIPEDA 合规 | 符合加拿大个人信息保护法 | P1 |

### 7.2 性能

| 需求 | 指标 | 优先级 |
|------|------|--------|
| 网站加载 | 首屏 < 2 秒 | P0 |
| API 响应 | 95% 请求 < 500ms | P0 |
| AI 回复 | < 3 秒（含检索 + 生成） | P0 |
| 网站采集 | 同步采集 < 10 秒 | P0 |
| CF 部署 | 含上传 < 15 秒 | P0 |
| 并发 | 支持 100 并发 | P1 |

### 7.3 可用性

| 需求 | 指标 | 优先级 |
|------|------|--------|
| 平台可用性 | 99.9% | P0 |
| 数据持久性 | D1 + R2 自动备份 | P0 |
| 部署回滚 | 保留历史，可重部署 | P1 |
| 离线容错 | 页面缓存支持短暂离线 | P2 |

### 7.4 可维护性

| 需求 | 实现方式 | 优先级 |
|------|----------|--------|
| CI/CD | GitHub Actions 自动部署 | P0 |
| 模块化 | 各功能模块分离 | P0 |
| 测试 | Vitest 单元测试 | P0 |
| 审计日志 | 追踪所有管理操作 | P0 |

---

## 8. 数据设计

### 8.1 中央数据库（D1）

#### merchants — 商户主表

| 列名 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | m-{uuid8} |
| name | TEXT NOT NULL | 商户名称 |
| email | TEXT | 邮箱 |
| phone | TEXT | 电话 |
| status | TEXT | active/frozen/expired/deleted |
| plan | TEXT | basic/standard/premium/custom |
| cf_account_email | TEXT | CF 账号邮箱 |
| cf_account_id | TEXT | CF 账号 ID |
| cf_api_token | TEXT | CF API Token |
| subdomain | TEXT UNIQUE | 子域名 |
| template_id | TEXT | 当前模板 |
| theme_color | TEXT | 主题色 |
| slogan | TEXT | 标语 |
| description | TEXT | 描述 |
| address | TEXT | 地址 |
| business_hours | TEXT | 营业时间 |
| logo_url | TEXT | Logo URL |
| cover_url | TEXT | 封面 URL |
| social_media | TEXT | 社交链接 JSON |
| created_at | TEXT | 创建时间 |
| expires_at | TEXT | 过期时间 |
| notes | TEXT | 备注 |

#### merchant_tokens — 商户令牌

| 列名 | 类型 | 说明 |
|------|------|------|
| merchant_id | TEXT PK | 商户 ID |
| token_hash | TEXT NOT NULL | Token 哈希 |
| issued_at | TEXT | 签发时间 |
| expires_at | TEXT | 过期时间 |
| last_verified_at | TEXT | 最后验证时间 |

#### deployments — 部署记录

| 列名 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | d-{uuid8} |
| merchant_id | TEXT NOT NULL | 商户 ID |
| version | TEXT NOT NULL | 版本号 |
| template_version | TEXT | 模板版本 |
| status | TEXT | pending/deploying/success/failed |
| worker_url | TEXT | Worker URL |
| pages_url | TEXT | Pages URL |
| cf_deployment_id | TEXT | CF 部署 ID |
| started_at | TEXT | 开始时间 |
| completed_at | TEXT | 结束时间 |
| error_log | TEXT | 错误日志 |
| deployed_by | TEXT | 部署人 |

#### templates — 模板表

| 列名 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 模板 ID |
| name | TEXT NOT NULL | 模板名称 |
| description | TEXT | 描述 |
| preview_url | TEXT | 预览 URL |
| is_active | INTEGER | 是否启用 |
| created_at | TEXT | 创建时间 |
| features | TEXT | 特性 JSON |

#### audit_logs — 审计日志

| 列名 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 日志 ID |
| action | TEXT NOT NULL | 操作类型 |
| target_type | TEXT NOT NULL | 目标类型 |
| target_id | TEXT | 目标 ID |
| detail | TEXT | 详情 |
| ip | TEXT | 请求 IP |
| created_at | TEXT | 创建时间 |

### 8.2 商户数据库

商户独立 D1 数据库包含以下表：

| 表名 | 用途 | 关键列 |
|------|------|--------|
| merchant_info | 商户自身数据 | id, name, slogan, description, phone, address, hours, primary_color, template_id |
| orders | 订单 | id, merchant_id, customer_name/phone/address, items, subtotal, total, status, payment_status |
| chat_messages | 聊天记录 | id, session_id, merchant_id, role, content, created_at |
| call_records | 通话记录 | id, call_sid, merchant_id, duration, recording_url, summary, status |
| knowledge_docs | 知识库文档 | id, merchant_id, drive_file_id, drive_file_name, drive_mime_type, drive_modified_at, status |
| knowledge_chunks | 知识库分块 | chunk_id, file_id, merchant_id, chunk_index, chunk_text |
| sync_log | 同步日志 | merchant_id, sync_type, status, files_processed, files_added, errors |
| call_conversation_archive | 通话归档 | call_sid, conversation |
| call_transfers | 转接记录 | call_sid, merchant_id, target_number |

---

## 9. API 设计

所有接口使用 JSON 格式，除公开接口外需在 Header 携带 `Authorization: Bearer {token}`。

### 9.1 公开接口

| 方法 | 路径 | 说明 | 限速 |
|------|------|------|------|
| GET | /api/health | 健康检查 | 无 |
| POST | /api/auth/login | 管理员登录 | 5/min/IP |
| POST | /api/merchants/verify | 商户 Token 验证 | 无 |

### 9.2 商户管理接口

| 方法 | 路径 | 说明 | 限速 |
|------|------|------|------|
| GET | /api/merchants | 列表 | 无 |
| GET | /api/merchants/:id | 详情 | 无 |
| POST | /api/merchants | 创建 | 20/min |
| PUT | /api/merchants/:id | 更新 | 20/min |
| DELETE | /api/merchants/:id | 软删除 | 20/min |
| POST | /api/merchants/:id/token | 重新生成 Token | 20/min |

### 9.3 部署接口

| 方法 | 路径 | 说明 | 限速 |
|------|------|------|------|
| GET | /api/merchants/:id/deployments | 部署历史 | 无 |
| POST | /api/merchants/:id/deployments | 创建部署记录 | 20/min |
| PUT | /api/deployments/:id | 更新状态 | 20/min |
| POST | /api/merchants/:id/deploy-cf | CF 直连部署 | 20/min |

### 9.4 模板接口

| 方法 | 路径 | 说明 | 限速 |
|------|------|------|------|
| GET | /api/templates | 模板列表 | 无 |
| POST | /api/templates/scrape | 采集网站 | 3/min |
| GET | /api/templates/scrape/:jobId | 查询采集任务 | 无 |
| GET | /api/templates/scrape-jobs | 采集任务列表 | 无 |
| GET | /api/templates/scrape/:id/file | 查看模板文件 | 无 |

---

## 10. 部署架构

### 10.1 域名配置

| 域名 | 目标 | 说明 |
|------|------|------|
| saas.roseai.ca | Admin UI | 中央管控平台 |
| rose-saas-central-api.touchwant.workers.dev | Central API Worker | API 端点 |
| storefront-{id}.pages.dev | 商户网站 | 按商户独立部署 |
| roseai.ca | 品牌官网 | 营销页面 |

### 10.2 架构图

```
中央管控平台（CF 账号 B）
┌──────────────────────────────┐
│ Admin UI     Central API     │
│ (Pages)      (Worker)        │
│         D1 / R2              │
└──────────────┬───────────────┘
               │ HTTPS + JWT
               ▼
商户 A（独立 CF 账号）
┌──────────────────────────────┐
│ Storefront   Merchant Worker │
│ (Pages)      /orders /chat   │
│                              │
│ D1  R2   Chat DO  Phone DO  │
│ 订单 图片  Vectorize         │
└──────────────────────────────┘
```

### 10.3 CI/CD 流程

1. 推送到 GitHub main 分支
2. GitHub Actions 自动触发
3. 部署 Central API Worker
4. 部署 Admin UI 到 Pages
5. 部署成功后立即生效

---

## 11. 成本估算

### 11.1 平台方成本

| 项目 | 月费 |
|------|------|
| Cloudflare Workers | $0 |
| Cloudflare D1 | $0（5GB 免费） |
| Cloudflare Pages | $0 |
| Cloudflare R2 | $0（10GB 免费） |
| Cloudflare Vectorize | $0（Beta 免费） |
| Workers AI | $0（免费额度内） |
| 域名 roseai.ca | ~$0.08/月 |
| **总计** | **~$0.08/月** |

### 11.2 每商户基础设施成本

| 项目 | 月费 |
|------|------|
| Cloudflare Workers/D1/R2/Pages | $0（免费额度内） |
| Vectorize / Workers AI | $0（Beta / 免费额度） |
| AI Token 费用（Standard+） | ~$0.30-0.50/月 |
| Twilio 语音（可选） | ~$2.50/月 |
| **合计** | **$0-3/月** |

### 11.3 运营成本对比（典型月流水 $9,000 CAD）

| 方案 | 月费 |
|------|------|
| RoseAI Essential（无支付） | $0-0.50/月 |
| RoseAI Premium（含 Stripe） | ~$351/月 |
| DoorDash/Uber Eats | $2,250-2,700/月 |

---

## 12. 未来规划

| 阶段 | 功能 |
|------|------|
| Phase 1（已完成） | 定制网站 + 模板系统 + 扫码点餐 + 员工后台 + CF 部署 |
| Phase 2（已完成） | AI 聊天机器人 + RAG 知识库 + Google Drive 同步 |
| Phase 3（已完成） | Stripe/Square 支付 + 支付流程自动化 |
| Phase 4（进行中） | AI 语音电话（Twilio）+ 多语言扩展 |
| Phase 5 | 商户自助后台 + 数据看板 + 营业报表 |
| Phase 6 | 多门店管理 + 集中数据看板 |
| Phase 7 | 聚合配送对接 + 供应链管理 |
| Phase 8 | 模板市场（第三方开发者上传） |

---

> **文档信息** | V3.0 | 2026-07-14 | 初稿 | 内部
