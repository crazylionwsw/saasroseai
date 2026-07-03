#!/usr/bin/env bash
# ============================================================
# deploy-merchant.sh — 一键部署商户到独立 Cloudflare 账号
# ============================================================
# 用法:
#   ./deploy-merchant.sh \\
#     --merchant-id=m-abc123 \\
#     --cf-email=merchant@email.com \\
#     --cf-api-token=xxxxx \\
#     --central-auth-url=https://api.平台.com \\
#     --merchant-token=xxxx \\
#     [--twilio-sid=ACxxx] \\
#     [--twilio-token=xxxx] \\
#     [--twilio-phone=+861380000000]
#
# 说明:
#   此脚本在商户的 Cloudflare 账号下创建所有资源并部署 Worker。
#   需要先安装 wrangler CLI 并登录中央账号（用于回注册）。

set -euo pipefail

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── 参数解析 ──
MERCHANT_ID=""
CF_EMAIL=""
CF_API_TOKEN=""
CENTRAL_AUTH_URL=""
MERCHANT_TOKEN=""
TWILIO_SID=""
TWILIO_TOKEN=""
TWILIO_PHONE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --merchant-id)    MERCHANT_ID="$2";    shift 2 ;;
    --cf-email)       CF_EMAIL="$2";       shift 2 ;;
    --cf-api-token)   CF_API_TOKEN="$2";   shift 2 ;;
    --central-auth-url) CENTRAL_AUTH_URL="$2"; shift 2 ;;
    --merchant-token) MERCHANT_TOKEN="$2"; shift 2 ;;
    --twilio-sid)     TWILIO_SID="$2";     shift 2 ;;
    --twilio-token)   TWILIO_TOKEN="$2";   shift 2 ;;
    --twilio-phone)   TWILIO_PHONE="$2";   shift 2 ;;
    *) error "未知参数: $1" ;;
  esac
done

# ── 参数校验 ──
[[ -z "$MERCHANT_ID" ]]    && error "缺少 --merchant-id"
[[ -z "$CF_EMAIL" ]]       && error "缺少 --cf-email"
[[ -z "$CF_API_TOKEN" ]]   && error "缺少 --cf-api-token"
[[ -z "$CENTRAL_AUTH_URL" ]] && error "缺少 --central-auth-url"
[[ -z "$MERCHANT_TOKEN" ]] && error "缺少 --merchant-token"

# ── 1. 切换到商户 CF 账号 ──
info "切换到商户 Cloudflare 账号: $CF_EMAIL"
export CLOUDFLARE_EMAIL="$CF_EMAIL"
export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_DIR="$SCRIPT_DIR/merchant-template/worker"

info "Worker 目录: $WORKER_DIR"

# ── 2. 创建 D1 数据库 ──
DB_NAME="restaurant-${MERCHANT_ID}"
info "创建 D1 数据库: $DB_NAME"
DB_OUTPUT=$(npx wrangler d1 create "$DB_NAME" 2>&1 || true)

if echo "$DB_OUTPUT" | grep -q "already exists"; then
  warn "D1 数据库已存在，跳过创建"
  # 获取已存在的 DB ID
  DB_ID=$(npx wrangler d1 list --json 2>/dev/null | jq -r ".[] | select(.name==\"$DB_NAME\") | .uuid")
elif echo "$DB_OUTPUT" | grep -q "database_id"; then
  DB_ID=$(echo "$DB_OUTPUT" | grep -oP 'database_id:\s*\K\S+')
else
  warn "无法解析 D1 输出，尝试手动获取..."
  DB_ID=$(npx wrangler d1 list --json 2>/dev/null | jq -r ".[] | select(.name==\"$DB_NAME\") | .uuid")
fi

[[ -z "$DB_ID" ]] && error "无法获取 D1 数据库 ID"
info "D1 数据库 ID: $DB_ID"

# ── 3. 初始化 D1 表 ──
info "初始化 D1 数据库表..."
npx wrangler d1 execute "$DB_NAME" --file "$WORKER_DIR/schema.sql" 2>&1 || warn "D1 初始化可能有警告"

# ── 4. 创建 R2 桶 ──
ASSETS_BUCKET="assets-${MERCHANT_ID}"
RECORDINGS_BUCKET="recordings-${MERCHANT_ID}"

for BUCKET in "$ASSETS_BUCKET" "$RECORDINGS_BUCKET"; do
  info "创建 R2 桶: $BUCKET"
  npx wrangler r2 bucket create "$BUCKET" 2>&1 || warn "R2 桶 $BUCKET 已存在，跳过"
done

# ── 5. 创建 Vectorize 索引 ──
VECTORIZE_NAME="knowledge-${MERCHANT_ID}"
info "创建 Vectorize 索引: $VECTORIZE_NAME"
npx wrangler vectorize create "$VECTORIZE_NAME" --dimensions 384 --metric cosine 2>&1 || warn "Vectorize 索引可能已存在，跳过"

# ── 6. 创建 Pages 项目 ──
PAGES_PROJECT="storefront-${MERCHANT_ID}"
info "创建 Pages 项目: $PAGES_PROJECT"
npx wrangler pages project create "$PAGES_PROJECT" --production-branch main 2>&1 || warn "Pages 项目已存在，跳过"

# 部署初始占位
TMPDIR=$(mktemp -d)
echo "<html><body><p>正在加载...</p></body></html>" > "$TMPDIR/index.html"
npx wrangler pages deploy "$TMPDIR" --project-name "$PAGES_PROJECT" 2>&1 || warn "Pages 首次部署可能失败"
rm -rf "$TMPDIR"

# ── 7. 更新 wrangler.jsonc 中的 binding ──
info "更新 wrangler.jsonc 配置..."
WRANGLER_CONFIG="$WORKER_DIR/wrangler.jsonc"

# 备份原文件
cp "$WRANGLER_CONFIG" "${WRANGLER_CONFIG}.bak"

# 使用 jq 替换 database_id（由于是 jsonc 格式，先用 sed 处理注释后用 jq，或用简单替换）
# 这里用 sed 简单替换占位空 database_id
sed -i '' "s/\"database_id\": \"\"/\"database_id\": \"$DB_ID\"/" "$WRANGLER_CONFIG"

# ── 8. 注入环境变量到 Worker ──
info "设置 Worker 环境变量..."

# 先确保 wrangler.jsonc 中有这些 secret 的声明
# 实际通过 wrangler secret 注入
echo "$CENTRAL_AUTH_URL" | npx wrangler secret put CENTRAL_AUTH_URL --name "restaurant-api-${MERCHANT_ID}" 2>/dev/null || true
echo "$MERCHANT_TOKEN" | npx wrangler secret put MERCHANT_TOKEN --name "restaurant-api-${MERCHANT_ID}" 2>/dev/null || true
echo "$MERCHANT_ID" | npx wrangler secret put MERCHANT_ID --name "restaurant-api-${MERCHANT_ID}" 2>/dev/null || true

if [[ -n "$TWILIO_SID" ]]; then
  echo "$TWILIO_SID" | npx wrangler secret put TWILIO_ACCOUNT_SID --name "restaurant-api-${MERCHANT_ID}" 2>/dev/null || true
fi
if [[ -n "$TWILIO_TOKEN" ]]; then
  echo "$TWILIO_TOKEN" | npx wrangler secret put TWILIO_AUTH_TOKEN --name "restaurant-api-${MERCHANT_ID}" 2>/dev/null || true
fi
if [[ -n "$TWILIO_PHONE" ]]; then
  echo "$TWILIO_PHONE" | npx wrangler secret put TWILIO_PHONE_NUMBER --name "restaurant-api-${MERCHANT_ID}" 2>/dev/null || true
fi

# ── 9. 部署 Worker ──
info "部署 Worker..."

# 临时修改 wrangler.jsonc 中的 name 为唯一名称
sed -i '' "s/\"name\": \"restaurant-api\"/\"name\": \"restaurant-api-${MERCHANT_ID}\"/" "$WRANGLER_CONFIG"

DEPLOY_OUTPUT=$(npx wrangler deploy --config "$WRANGLER_CONFIG" 2>&1) || error "Worker 部署失败"
echo "$DEPLOY_OUTPUT"

# 提取 Worker URL
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oP 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)
PAGES_URL="https://${PAGES_PROJECT}.pages.dev"

# ── 10. 恢复 wrangler.jsonc ──
mv "${WRANGLER_CONFIG}.bak" "$WRANGLER_CONFIG"

# ── 11. 回注册到中央后台 ──
info "回注册到中央后台..."
CENTRAL_API="${CENTRAL_AUTH_URL}/api/merchants/${MERCHANT_ID}/deployments"
DEPLOY_PAYLOAD="{
  \"merchantId\": \"${MERCHANT_ID}\",
  \"version\": \"1.0.0\",
  \"status\": \"success\",
  \"workerUrl\": \"${WORKER_URL}\",
  \"pagesUrl\": \"${PAGES_URL}\",
  \"cfDeploymentId\": \"${MERCHANT_ID}-$(date +%s)\"
}"

curl -s -X POST "$CENTRAL_API" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
  -d "$DEPLOY_PAYLOAD" || warn "中央回注册失败（可手动注册）"

# ── 12. 部署模板网站到 Pages ──
info "部署模板网站到 Pages..."
TEMPLATES_DIR="$SCRIPT_DIR/merchant-template/templates"
for tmpl in "$TEMPLATES_DIR"/*/; do
  tmpl_name=$(basename "$tmpl")
  info "  部署模板: $tmpl_name"
  npx wrangler pages deploy "$tmpl" --project-name "$PAGES_PROJECT" --branch "$tmpl_name" 2>&1 || warn "  模板 $tmpl_name 部署失败"
done

# ── 完成 ──
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  商户部署完成!${NC}"
echo -e "${GREEN}  Merchant ID: ${MERCHANT_ID}${NC}"
echo -e "${GREEN}  Worker URL:  ${WORKER_URL}${NC}"
echo -e "${GREEN}  Store URL:   ${PAGES_URL}${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
