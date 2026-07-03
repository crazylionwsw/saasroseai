# 部署方案：saas.roseai.ca

## 域名架构

```
roseai.ca（已有 Cloudflare 账号 A，www.roseai.ca 官网已部署）
 │
 ├── www.roseai.ca  → 已有官网（不动）
 │
 └── saas.roseai.ca → 新建 SaaS 平台 ← 新注册 Cloudflare 账号 B
      │
      ├── saas.roseai.ca/*          → 管理后台 Pages
      ├── api.saas.roseai.ca/*      → 中央 API Worker
      └── shop-{id}.saas.roseai.ca  → 商户官网（生成后添加）
```

---

## 整体策略

因为 `roseai.ca` 已经在账号 A 上管理，不能直接添加到新账号 B。采用 **CNAME 接入**方案：

```
新账号 B 部署资源（获得 workers.dev / pages.dev 地址）
        │
账号 A（roseai.ca 所在账号）添加 DNS CNAME 记录
        │
        ▼
saas.roseai.ca → CNAME → 新账号 B 的 Pages
api.saas.roseai.ca → CNAME → 新账号 B 的 Worker
```

双方 Cloudflare 的橙色云（Proxy）功能正常生效，SSL 自动管理。

---

## 第一步：注册新 Cloudflare 账号

**账号 B**：专门给这个 SaaS 项目使用

```bash
# 1. 打开 https://dash.cloudflare.com/sign-up
#    用新邮箱注册（如 saas@roseai.ca）

# 2. 安装 wrangler 并登录新账号
wrangler login
# 浏览器会打开，授权新账号 B

# 3. 验证
wrangler whoami
# → 显示新账号 B 的邮箱
```

---

## 第二步：部署中央平台（在账号 B 中）

### 2.1 克隆项目 & 安装依赖

```bash
git clone <你的仓库地址> rose-saas
cd rose-saas
npm install
```

### 2.2 创建 D1 数据库

```bash
npx wrangler d1 create rose-saas-central --config central/api/wrangler.jsonc

# 输出类似:
# ✅ Created database 'rose-saas-central'
# database_id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

将输出的 `database_id` 写入 `central/api/wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "CENTRAL_DB",
    "database_name": "rose-saas-central",
    "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
]
```

### 2.3 初始化表结构

```bash
npx wrangler d1 execute rose-saas-central \
  --file central/schema.sql \
  --config central/api/wrangler.jsonc
```

### 2.4 创建 R2 桶（模板存储）

```bash
npx wrangler r2 bucket create rose-saas-templates \
  --config central/api/wrangler.jsonc
```

### 2.5 上传初始模板

```bash
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

### 2.6 删除 routes 配置（用 workers.dev 域名即可）

修改 `central/api/wrangler.jsonc`，删除 routes 段（稍后通过 CNAME 接入）：

```jsonc
// 删除这一段:
// "routes": [
//   { "pattern": "api.平台.com/*", "zone_name": "平台.com", "custom_domain": true }
// ]
```

### 2.7 设置 JWT 和 Admin Token

```bash
# 生成随机密钥
JWT_KEY=$(openssl rand -hex 32)
echo "JWT_SECRET: $JWT_KEY"

# 设置到 Worker
echo "$JWT_KEY" | npx wrangler secret put JWT_SECRET \
  --name rose-saas-central-api \
  --config central/api/wrangler.jsonc

# 设置 Admin Token（你自己管理的密码）
echo "my-admin-token-123" | npx wrangler secret put ADMIN_API_TOKEN \
  --name rose-saas-central-api \
  --config central/api/wrangler.jsonc
```

### 2.8 部署中央 API

```bash
npx wrangler deploy --config central/api/wrangler.jsonc

# 输出示例:
# ✅ Deployed 'rose-saas-central-api' (global)
# https://rose-saas-central-api.xxxx.workers.dev
#
# 记下这个 URL，后面要用
```

### 2.9 部署管理后台 Pages

```bash
npx wrangler pages project create rose-saas-admin \
  --production-branch main

npx wrangler pages deploy central/admin-ui \
  --project-name rose-saas-admin

# 输出示例:
# ✅ Deployed! https://rose-saas-admin.pages.dev
#
# 记下这个 URL
```

### 2.10 验证部署

```bash
# 验证 API
curl https://rose-saas-central-api.xxxx.workers.dev/api/health
# → {"status":"ok"}

# 验证创建商户
curl -X POST https://rose-saas-central-api.xxxx.workers.dev/api/merchants \
  -H "Authorization: Bearer my-admin-token-123" \
  -H "Content-Type: application/json" \
  -d '{"name":"测试餐厅","templateId":"classic"}'
# → 返回商户信息

# 验证管理后台
open https://rose-saas-admin.pages.dev
# → 应弹出 Token 输入框
```

---

## 第三步：配置域名 DNS（在账号 A 中操作）

登录到 **已有的 Cloudflare 账号 A**（roseai.ca 所在账号），不要登录账号 B。

### 3.1 添加 CNAME 记录

在 DNS 设置页面添加：

| 类型 | 名称 | 目标 | 代理（橙色云） |
|------|------|------|--------------|
| CNAME | `saas` | `rose-saas-admin.pages.dev` | ✅ 开启 |
| CNAME | `api.saas` | `rose-saas-central-api.xxxx.workers.dev` | ✅ 开启 |

### 3.2 等待 DNS 生效

```bash
# 验证解析
dig saas.roseai.ca CNAME +short
# → rose-saas-admin.pages.dev

dig api.saas.roseai.ca CNAME +short
# → rose-saas-central-api.xxxx.workers.dev

# 验证可访问
curl -I https://saas.roseai.ca
# → 200 OK

curl -I https://api.saas.roseai.ca/api/health
# → 200 OK
```

### 3.3 为商户官网预留通配符

后续商户官网使用 `shop-{id}.saas.roseai.ca`，需要在账号 A 中添加通配符 CNAME：

| 类型 | 名称 | 目标 | 代理 |
|------|------|------|--------------|
| CNAME | `*.saas` | `rose-saas-admin.pages.dev` | ✅ 开启 |

这样 `shop-a.saas.roseai.ca`、`shop-b.saas.roseai.ca` 都会自动指向。

---

## 第四步：配置中央 API 的路由（可选）

当 DNS 生效后，可以让中央 API Worker 绑定自定义域名：

```bash
# 在账号 B 中，给 Worker 添加自定义域名
npx wrangler tail --name rose-saas-central-api --config central/api/wrangler.jsonc
```

或者回到账号 A，创建一条 **Worker Route**：

```
账号 A Dashboard → Workers 路由 → 添加路由
  Route: api.saas.roseai.ca/*
  Worker: （选择账号 B 的 Worker？不行，跨账号不行）
```

**结论**：跨账号无法直接创建 Worker Route。CNAME 方式已经够用，不需要额外的 Worker Route。Cloudflare 会自动为 CNAME 目标（pages.dev / workers.dev）代理请求。

---

## 第五步：部署商户实例

### 5.1 创建商户 + 生成 JWT

```bash
# 通过 API 创建商户
curl -X POST https://api.saas.roseai.ca/api/merchants \
  -H "Authorization: Bearer my-admin-token-123" \
  -H "Content-Type: application/json" \
  -d '{"name":"张三餐厅","templateId":"classic"}'

# 返回: { "id": "m-abc123", "subdomain": "shop-m-abc123", ... }

# 生成 JWT Token
curl -X POST https://api.saas.roseai.ca/api/merchants/m-abc123/token \
  -H "Authorization: Bearer my-admin-token-123"

# 返回: { "token": "eyJhbGciOiJIUzI1NiIs..." }
```

### 5.2 部署到商户独立 CF 账号

```bash
./scripts/deploy-merchant.sh \
  --merchant-id=m-abc123 \
  --cf-email=商户CF邮箱 \
  --cf-api-token=商户CF_API_TOKEN \
  --central-auth-url=https://api.saas.roseai.ca \
  --merchant-token=上一步生成的JWT
```

---

## 完整域名映射表

| 域名 | 指向 | 管理位置 |
|------|------|---------|
| `www.roseai.ca` | 已有官网 | 账号 A |
| `roseai.ca` | 根域名（已有） | 账号 A |
| `saas.roseai.ca` | CNAME → `rose-saas-admin.pages.dev` | 账号 A 的 DNS |
| `api.saas.roseai.ca` | CNAME → `rose-saas-central-api.xxx.workers.dev` | 账号 A 的 DNS |
| `*.saas.roseai.ca` | CNAME → `rose-saas-admin.pages.dev` | 账号 A 的 DNS |
| 商户 Worker | `restaurant-api-m-xxx.xxx.workers.dev` | 账号 B（通过 API 管理） |
| 商户 Pages | `storefront-m-xxx.pages.dev` | 账号 B（通过 API 管理） |

---

## 总结

```
注册新CF账号B → wrangler login → 创建D1/R2 → 部署Worker/Pages
        │
        ▼
在已有账号A中添加DNS CNAME记录
  saas.roseai.ca → rose-saas-admin.pages.dev
  api.saas.roseai.ca → rose-saas-central-api.xxx.workers.dev
  *.saas.roseai.ca → rose-saas-admin.pages.dev
        │
        ▼
访问 https://saas.roseai.ca → 管理后台
访问 https://api.saas.roseai.ca/api/health → API 正常
```

整个部署过程约 **30 分钟**，全部服务在免费额度内。
