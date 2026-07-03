# 部署方案

---

## 概览

```
┌─────────────────────────────────────────┐
│  1. 中央管控平台（你的 Cloudflare 账号）   │
│     central/api     → Worker            │
│     central/admin-ui → Pages            │
│     central/schema   → D1               │
│     templates        → R2               │
└─────────────────────────────────────────┘
                    │
                    ▼ (管理所有商户)
┌─────────────────────────────────────────┐
│  2. 商户独立部署（每个商户的 CF 账号）     │
│     merchant-template/worker → Worker    │
│     merchant-template/schema → D1        │
│     merchant-template/templates → Pages  │
│     R2 / Vectorize / DO 等               │
└─────────────────────────────────────────┘
```

---

## 一、前置准备

### 1.1 工具安装

```bash
# 安装 Node.js >= 18
node -v   # 需 v18+

# 安装 wrangler CLI
npm install -g wrangler

# 登录你的 Cloudflare 账号（中央管控用）
wrangler login

# 登录后会生成 ~/.wrangler/config/default.toml
wrangler whoami
```

### 1.2 需要的账号

| 账号 | 用途 | 费用 |
|------|------|------|
| **Cloudflare 账号（你）** | 中央管控平台 | 免费 |
| **Cloudflare 账号（商户）** | 商户独立资源 | 免费（每商户） |
| **域名（可选）** | 绑定自定义域名 | ~$10/年 |
| **Twilio 账号** | 语音电话 | $1/号/月 + 按分钟 |

### 1.3 项目依赖

```bash
cd restaurant-saas
npm install
```

---

## 二、部署中央管控平台

### 2.1 创建 D1 数据库

```bash
# 创建中央数据库
npx wrangler d1 create rose-saas-central --config central/api/wrangler.jsonc

# 输出示例:
# ✅ Created database 'rose-saas-central'
# database_id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# 复制输出的 database_id，更新到 central/api/wrangler.jsonc:
# "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# 初始化表结构
npx wrangler d1 execute rose-saas-central \
  --file central/schema.sql \
  --config central/api/wrangler.jsonc
```

### 2.2 创建 R2 桶（模板存储）

```bash
npx wrangler r2 bucket create rose-saas-templates \
  --config central/api/wrangler.jsonc
```

### 2.3 设置环境变量

```bash
# JWT 密钥（用于签发商户 token）
npx wrangler secret put JWT_SECRET \
  --name rose-saas-central-api \
  --config central/api/wrangler.jsonc
# 输入一个随机字符串，例如: openssl rand -hex 32

# Admin API Token（中央后台登录用）
npx wrangler secret put ADMIN_API_TOKEN \
  --name rose-saas-central-api \
  --config central/api/wrangler.jsonc
# 输入一个复杂密码
```

### 2.4 上传初始模板

```bash
# 将 merchant-template/templates/ 下的模板上传到 R2
for tmpl in merchant-template/templates/*/; do
  tmpl_name=$(basename "$tmpl")
  echo "上传模板: $tmpl_name"
  for file in "$tmpl"/*; do
    key="${tmpl_name}/$(basename "$file")"
    npx wrangler r2 object put "rose-saas-templates/$key" \
      --file "$file" \
      --config central/api/wrangler.jsonc
  done
done
```

### 2.5 部署中央 API

```bash
npx wrangler deploy --config central/api/wrangler.jsonc

# 输出示例:
# ✅ Deployed 'rose-saas-central-api' (global)
# https://rose-saas-central-api.xxxx.workers.dev
```

### 2.6 部署中央管理后台

```bash
# 首次创建 Pages 项目
npx wrangler pages project create rose-saas-admin \
  --production-branch main

# 部署
npx wrangler pages deploy central/admin-ui \
  --project-name rose-saas-admin

# 输出示例:
# ✅ Deployed! https://rose-saas-admin.pages.dev
```

### 2.7 绑定自定义域名（可选）

```bash
# 在 Cloudflare Dashboard 中:
# 1. 添加你的域名到 Cloudflare
# 2. Workers Routes → 添加路由 api.你的域名.com/* → rose-saas-central-api
# 3. Pages → rose-saas-admin → 自定义域 → admin.你的域名.com
```

### 2.8 验证中央平台

```bash
# 测试健康检查
curl https://rose-saas-central-api.xxxx.workers.dev/api/health

# 测试创建商户（用你设置的 ADMIN_API_TOKEN）
curl -X POST https://rose-saas-central-api.xxxx.workers.dev/api/merchants \
  -H "Authorization: Bearer 你的ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"测试餐厅","templateId":"classic"}'

# 打开管理后台
open https://rose-saas-admin.pages.dev
```

---

## 三、部署商户独立实例

### 3.1 前置条件（需要从商户获取）

| 信息 | 说明 |
|------|------|
| Cloudflare 邮箱 | 商户注册 CF 的邮箱 |
| Cloudflare API Token | 商户需创建 API Token（权限：编辑 Workers/D1/R2/Pages） |
| Twilio 信息（可选） | Account SID, Auth Token, Phone Number |

### 3.2 商户需要执行的操作

给商户的指引（可截图发给商户）：

```
1. 注册 Cloudflare 账号: https://dash.cloudflare.com/sign-up
2. 创建 API Token:
   Dashboard → 右上角头像 → My Profile → API Tokens → Create Token
   使用 "Edit Cloudflare Workers" 模板
   权限: Account/Workers/Edit, Account/D1/Edit, Account/R2/Edit, Account/Pages/Edit
3. 把以下信息发给我们:
   - Cloudflare 邮箱
   - API Token（以 xxxxx 开头的字符串）
   - （如果有电话功能）Twilio Account SID 和 Auth Token
```

### 3.3 一键部署脚本

```bash
# 在你的开发环境运行
./scripts/deploy-merchant.sh \
  --merchant-id=m-abc123 \
  --cf-email=merchant@example.com \
  --cf-api-token=商户的API_TOKEN \
  --central-auth-url=https://rose-saas-central-api.xxxx.workers.dev \
  --merchant-token=<从中央后台生成的JWT> \
  --twilio-sid=ACxxxx \
  --twilio-token=xxxx \
  --twilio-phone=+861380000000
```

脚本会自动完成以下步骤：

```
1. 创建 D1 数据库 restaurant-m-abc123
2. 初始化表结构（schema.sql）
3. 创建 R2 桶 assets-m-abc123 和 recordings-m-abc123
4. 创建 Vectorize 索引 knowledge-m-abc123（384维）
5. 创建 Pages 项目 storefront-m-abc123
6. 部署 Worker，注入环境变量（中央认证 URL / Token / Twilio）
7. 回注册到中央后台（记录部署状态）
8. 上传模板网站到 Pages
```

### 3.4 手动分步部署（如果脚本失败）

```bash
# 切换到商户 CF 账号
export CLOUDFLARE_EMAIL="merchant@example.com"
export CLOUDFLARE_API_TOKEN="商户的API_TOKEN"

# 创建 D1
npx wrangler d1 create restaurant-m-abc123
npx wrangler d1 execute restaurant-m-abc123 --file merchant-template/worker/schema.sql

# 创建 R2
npx wrangler r2 bucket create assets-m-abc123
npx wrangler r2 bucket create recordings-m-abc123

# 创建 Vectorize
npx wrangler vectorize create knowledge-m-abc123 --dimensions 384 --metric cosine

# 部署 Worker
cd merchant-template/worker
npx wrangler deploy \
  --name restaurant-api-m-abc123 \
  --d1 "MERCHANT_DB=restaurant-m-abc123" \
  --r2 "ASSETS=assets-m-abc123" \
  --r2 "RECORDINGS=recordings-m-abc123" \
  --vectorize "KNOWLEDGE=knowledge-m-abc123"

# 设置环境变量
echo "https://rose-saas-central-api.xxxx.workers.dev" | wrangler secret put CENTRAL_AUTH_URL
echo "商户的JWT_TOKEN" | wrangler secret put MERCHANT_TOKEN
echo "m-abc123" | wrangler secret put MERCHANT_ID
```

---

## 四、生成商户 JWT Token

在中央后台生成商户的认证 JWT：

```bash
# 方式1：通过 API
curl -X POST https://rose-saas-central-api.xxxx.workers.dev/api/merchants/m-abc123/token \
  -H "Authorization: Bearer 你的ADMIN_TOKEN"

# 返回: { "token": "eyJhbGciOiJIUzI1NiIs..." }

# 方式2：通过管理后台
# 打开 admin.你的域名.com → 商户管理 → 点击商户 → Token 管理 → 重新生成
```

---

## 五、配置商户官网

### 5.1 商户初始化设置

商户登录你的后台（`admin.你的域名.com`）后：

```
1. 填写餐厅信息（名称、简介、Logo、电话、地址、营业时间）
2. 上传菜品数据（分类 → 菜品名 → 价格 → 图片）
3. 选择模板（classic / modern / 采集生成的模板）
4. 点击"生成官网"
5. 系统自动部署到商户 Pages，返回网址
```

### 5.2 模板采集（从已有网站生成新模板）

```
1. 后台 → 模板管理 → 点击"采集网站"
2. 输入目标餐厅 URL（如 https://example-restaurant.com）
3. 系统自动抓取 + AI 分析 → 生成新模板
4. 新模板出现在模板列表中，可供所有商户选用
```

---

## 六、更新商户实例

### 6.1 全量更新所有商户

```bash
./scripts/update-all.sh \
  --central-url=https://rose-saas-central-api.xxxx.workers.dev \
  --admin-token=你的ADMIN_TOKEN
```

脚本会：
1. 从中央后台获取所有 active 商户
2. 逐个重新部署 Worker
3. 记录新版本号

### 6.2 更新指定商户

```bash
# 重新部署 worker
npx wrangler deploy --config merchant-template/worker/wrangler.jsonc \
  --name restaurant-api-m-abc123

# 更新模板网站
npx wrangler pages deploy merchant-template/templates/classic \
  --project-name storefront-m-abc123
```

---

## 七、系统配置参数

### 7.1 中央 API 环境变量

| 变量 | 说明 | 设置方式 |
|------|------|---------|
| `JWT_SECRET` | JWT 签名密钥（32+ 字符随机串） | `wrangler secret put` |
| `ADMIN_API_TOKEN` | 管理后台登录 Token | `wrangler secret put` |

### 7.2 商户 Worker 环境变量

| 变量 | 说明 | 设置方式 |
|------|------|---------|
| `CENTRAL_AUTH_URL` | 中央认证 API 地址 | `wrangler secret put` |
| `MERCHANT_TOKEN` | 商户 JWT（中央签发） | `wrangler secret put` |
| `MERCHANT_ID` | 商户 ID | `wrangler secret put` |
| `TWILIO_ACCOUNT_SID` | Twilio 账号 SID | `wrangler secret put` |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | `wrangler secret put` |
| `TWILIO_PHONE_NUMBER` | Twilio 电话号码 | `wrangler secret put` |

---

## 八、部署拓扑图

```
                        Internet
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
    admin.你的域名.com           shop-a.商户域名.com
    (Cloudflare Pages)          (Cloudflare Pages)
              │                         │
              ▼                         ▼
    rose-saas-central-api       restaurant-api-m-xxx
    (Cloudflare Workers)        (Cloudflare Workers)
              │                         │
              ▼                         ▼
    Central D1 + R2              Merchant D1 + R2 + Vectorize
              │                         │
              └──────────┬──────────────┘
                         ▼
                Google Drive API
                (商户知识库源)
```

### 域名规划

```
中央平台:
  api.你的域名.com       → 中央 API Worker
  admin.你的域名.com      → 中央管理后台 Pages

商户:
  shop-{id}.你的域名.com  → 商户官网 Pages
  api-{id}.你的域名.com   → 商户 API Worker
```

---

## 九、上线检查清单

### 中央平台

- [ ] D1 数据库创建成功，schema 初始化完成
- [ ] R2 桶创建成功，初始模板已上传
- [ ] JWT_SECRET 和 ADMIN_API_TOKEN 已设置
- [ ] 中央 API Worker 部署成功，`/api/health` 返回 200
- [ ] 管理后台 Pages 部署成功，可正常登录
- [ ] 可创建商户、生成 Token、查看部署记录

### 商户实例

- [ ] 商户 Cloudflare API Token 权限正确
- [ ] 部署脚本执行成功，无错误
- [ ] Worker 可正常响应（`/api/health` 返回商户 ID）
- [ ] 商户官网 Pages 可访问
- [ ] 官网模板正确渲染（图片/菜单/联系方式）
- [ ] 测试订单可正常创建
- [ ] Google Drive 知识库可同步（如已配置）
- [ ] Twilio 电话可呼入（如已配置）

### 功能验证

- [ ] 官网展示 → 打开商户 URL → 正常显示
- [ ] 在线下单 → 提交订单 → 数据存入 D1
- [ ] 在线支付 → 跳转支付页 → 回调处理
- [ ] 智能客服 → 发送消息 → AI 回复
- [ ] 智能电话 → 拨打号码 → 语音对话
- [ ] 知识库同步 → Google Drive 文件 → Vectorize

---

## 十、常见问题

### 10.1 Workers 免费额度不够

```
症状: Worker 返回 1027 (exceeded limits)
解决:
  1. 升级商户到 Cloudflare Workers Paid ($5/月)
  2. 或优化代码减少请求量
  3. 或使用缓存减少重复计算
```

### 10.2 部署脚本报错 "already exists"

```
原因: 商户账号已有同名资源
解决: 脚本会自动检测并跳过已存在的资源，不影响后续步骤
```

### 10.3 商户官网白屏

```
排查:
  1. 检查 Pages 部署状态 → 重新部署
  2. 检查 Worker API 是否返回数据
  3. 浏览器 Console → 查看网络请求错误
  4. 确认 TEMPLATES_R2 中有正确的模板文件
```

### 10.4 电话功能不可用

```
排查:
  1. 确认 Twilio 账号已充值
  2. 确认 Twilio Phone Number 已购买
  3. 确认 Twilio Voice Webhook URL 指向商户 Worker
  4. 在商户 Worker 日志中查看 webhook 调用
```

### 10.5 知识库同步失败

```
排查:
  1. 确认商户已授权 Google Drive（OAuth token 未过期）
  2. 确认 Drive 文件夹 ID 正确
  3. 查看 Worker 日志（knowledge-sync cron）
  4. 检查 Vectorize 索引状态
```
