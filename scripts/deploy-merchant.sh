#!/usr/bin/env bash
# ============================================================
# deploy-merchant.sh — 一键部署商户到独立 Cloudflare 账号
# ============================================================
# 用法:
#   ./deploy-merchant.sh \
#     --merchant-id=m-abc123 \
#     --cf-email=merchant@email.com \
#     --cf-api-token=xxxxx \
#     --central-auth-url=https://rose-saas-central-api.xxx.workers.dev \
#     --merchant-token=xxxx \
#     [--admin-token=中央管理员Token] \
#     [--stripe-secret-key=sk_xxx] [--stripe-webhook-secret=whsec_xxx] [--stripe-client-id=ca_xxx] \
#     [--square-access-token=EAAAxxx] [--square-location-id=Lxxx] \
#     [--square-webhook-signature-key=xxx] [--square-client-id=xxx] [--square-client-secret=xxx] \
#     [--twilio-sid=ACxxx] [--twilio-token=xxxx] [--twilio-phone=+1...] \
#     [--migrate-only]
#
# 说明:
#   在商户的 Cloudflare 账号下创建资源、执行迁移、部署 Worker，并回注册到中央后台。

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

MERCHANT_ID=""; CF_EMAIL=""; CF_API_TOKEN=""; CENTRAL_AUTH_URL=""; MERCHANT_TOKEN=""; ADMIN_TOKEN=""
STRIPE_SECRET_KEY=""; STRIPE_WEBHOOK_SECRET=""; STRIPE_CLIENT_ID=""
SQUARE_ACCESS_TOKEN=""; SQUARE_LOCATION_ID=""; SQUARE_WEBHOOK_SIGNATURE_KEY=""; SQUARE_CLIENT_ID=""; SQUARE_CLIENT_SECRET=""
TWILIO_SID=""; TWILIO_TOKEN=""; TWILIO_PHONE=""
MIGRATE_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --merchant-id)    MERCHANT_ID="$2";    shift 2 ;;
    --cf-email)       CF_EMAIL="$2";       shift 2 ;;
    --cf-api-token)   CF_API_TOKEN="$2";   shift 2 ;;
    --central-auth-url) CENTRAL_AUTH_URL="$2"; shift 2 ;;
    --merchant-token) MERCHANT_TOKEN="$2"; shift 2 ;;
    --admin-token)    ADMIN_TOKEN="$2";    shift 2 ;;
    --stripe-secret-key) STRIPE_SECRET_KEY="$2"; shift 2 ;;
    --stripe-webhook-secret) STRIPE_WEBHOOK_SECRET="$2"; shift 2 ;;
    --stripe-client-id) STRIPE_CLIENT_ID="$2"; shift 2 ;;
    --square-access-token) SQUARE_ACCESS_TOKEN="$2"; shift 2 ;;
    --square-location-id) SQUARE_LOCATION_ID="$2"; shift 2 ;;
    --square-webhook-signature-key) SQUARE_WEBHOOK_SIGNATURE_KEY="$2"; shift 2 ;;
    --square-client-id) SQUARE_CLIENT_ID="$2"; shift 2 ;;
    --square-client-secret) SQUARE_CLIENT_SECRET="$2"; shift 2 ;;
    --twilio-sid)     TWILIO_SID="$2";     shift 2 ;;
    --twilio-token)   TWILIO_TOKEN="$2";   shift 2 ;;
    --twilio-phone)   TWILIO_PHONE="$2";   shift 2 ;;
    --migrate-only)   MIGRATE_ONLY=1;      shift 1 ;;
    *) error "未知参数: $1" ;;
  esac
done

[[ -z "$MERCHANT_ID" ]]    && error "缺少 --merchant-id"
[[ -z "$CF_API_TOKEN" ]]   && error "缺少 --cf-api-token"
if [[ "$MIGRATE_ONLY" == "0" ]]; then
  [[ -z "$CF_EMAIL" ]]         && error "缺少 --cf-email"
  [[ -z "$CENTRAL_AUTH_URL" ]] && error "缺少 --central-auth-url"
  [[ -z "$MERCHANT_TOKEN" ]]   && error "缺少 --merchant-token"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_DIR="$SCRIPT_DIR/merchant-template/worker"
WRANGLER_CONFIG="$WORKER_DIR/wrangler.jsonc"
DB_NAME="restaurant-${MERCHANT_ID}"
WORKER_NAME="restaurant-api-${MERCHANT_ID}"

export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
[[ -n "$CF_EMAIL" ]] && export CLOUDFLARE_EMAIL="$CF_EMAIL"

portable_sed() { sed -i.bak "$1" "$2" && rm -f "${2}.bak"; }

# ── 1. D1 数据库 ──
info "获取/创建 D1 数据库: $DB_NAME"
DB_ID=$(npx wrangler d1 list --json 2>/dev/null | jq -r ".[] | select(.name==\"$DB_NAME\") | .uuid" || true)
if [[ -z "$DB_ID" || "$DB_ID" == "null" ]]; then
  npx wrangler d1 create "$DB_NAME" >/dev/null 2>&1 || true
  DB_ID=$(npx wrangler d1 list --json 2>/dev/null | jq -r ".[] | select(.name==\"$DB_NAME\") | .uuid")
fi
[[ -z "$DB_ID" || "$DB_ID" == "null" ]] && error "无法获取 D1 数据库 ID"
info "D1 ID: $DB_ID"

# ── 2. 执行 schema + 迁移（幂等） ──
info "执行数据库迁移..."
bash "$SCRIPT_DIR/scripts/migrate-merchant.sh" --db-name "$DB_NAME" || error "迁移失败"

if [[ "$MIGRATE_ONLY" == "1" ]]; then
  info "仅迁移模式，完成 ✅"
  exit 0
fi

# ── 3. R2 桶 ──
for BUCKET in "assets-${MERCHANT_ID}" "recordings-${MERCHANT_ID}"; do
  info "R2 桶: $BUCKET"
  npx wrangler r2 bucket create "$BUCKET" >/dev/null 2>&1 || warn "  已存在，跳过"
done

# ── 4. Vectorize ──
info "Vectorize 索引: knowledge-${MERCHANT_ID}"
npx wrangler vectorize create "knowledge-${MERCHANT_ID}" --dimensions 384 --metric cosine >/dev/null 2>&1 \
  || warn "  已存在，跳过"

# ── 5. Pages 项目 ──
PAGES_PROJECT="storefront-${MERCHANT_ID}"
info "Pages 项目: $PAGES_PROJECT"
npx wrangler pages project create "$PAGES_PROJECT" --production-branch main >/dev/null 2>&1 \
  || warn "  已存在，跳过"
TMPDIR=$(mktemp -d)
echo "<html><body><p>正在加载...</p></body></html>" > "$TMPDIR/index.html"
npx wrangler pages deploy "$TMPDIR" --project-name "$PAGES_PROJECT" --branch main >/dev/null 2>&1 \
  || warn "  Pages 首次部署可能失败"
rm -rf "$TMPDIR"

# ── 6. 临时配置注入（database_id + worker name），部署后恢复 ──
cp "$WRANGLER_CONFIG" "${WRANGLER_CONFIG}.bak"
portable_sed "s/\"database_id\": \"[^\"]*\"/\"database_id\": \"$DB_ID\"/" "$WRANGLER_CONFIG"
portable_sed "s/\"name\": \"restaurant-api\"/\"name\": \"$WORKER_NAME\"/" "$WRANGLER_CONFIG"

restore_config() { [[ -f "${WRANGLER_CONFIG}.bak" ]] && mv "${WRANGLER_CONFIG}.bak" "$WRANGLER_CONFIG"; }
trap restore_config EXIT

# ── 7. 部署 Worker ──
info "部署 Worker: $WORKER_NAME"
DEPLOY_OUTPUT=$(npx wrangler deploy --config "$WRANGLER_CONFIG" 2>&1) || { restore_config; error "Worker 部署失败"; }
echo "$DEPLOY_OUTPUT"
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1 || true)

# ── 8. Secrets ──
put_secret() {
  local name="$1" value="$2"
  [[ -z "$value" ]] && return 0
  printf '%s' "$value" | npx wrangler secret put "$name" --name "$WORKER_NAME" >/dev/null 2>&1 \
    && info "  secret: $name ✓" || warn "  secret: $name 失败"
}
info "设置 Secrets..."
put_secret CENTRAL_AUTH_URL "$CENTRAL_AUTH_URL"
put_secret MERCHANT_TOKEN "$MERCHANT_TOKEN"
put_secret MERCHANT_ID "$MERCHANT_ID"
put_secret STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"
put_secret STRIPE_WEBHOOK_SECRET "$STRIPE_WEBHOOK_SECRET"
put_secret STRIPE_CLIENT_ID "$STRIPE_CLIENT_ID"
put_secret SQUARE_ACCESS_TOKEN "$SQUARE_ACCESS_TOKEN"
put_secret SQUARE_LOCATION_ID "$SQUARE_LOCATION_ID"
put_secret SQUARE_WEBHOOK_SIGNATURE_KEY "$SQUARE_WEBHOOK_SIGNATURE_KEY"
put_secret SQUARE_CLIENT_ID "$SQUARE_CLIENT_ID"
put_secret SQUARE_CLIENT_SECRET "$SQUARE_CLIENT_SECRET"
put_secret TWILIO_ACCOUNT_SID "$TWILIO_SID"
put_secret TWILIO_AUTH_TOKEN "$TWILIO_TOKEN"
put_secret TWILIO_PHONE_NUMBER "$TWILIO_PHONE"

# ── 9. 健康检查 ──
if [[ -n "$WORKER_URL" ]]; then
  info "健康检查: $WORKER_URL/api/health"
  for i in 1 2 3; do
    if curl -fsS "$WORKER_URL/api/health" | grep -q '"ok"'; then
      info "  Worker 健康 ✓"
      break
    fi
    [[ "$i" == "3" ]] && warn "  健康检查未通过（可能需要时间生效）"
    sleep 2
  done
fi

# ── 10. 部署模板网站 ──
info "部署模板网站..."
for tmpl in "$SCRIPT_DIR"/merchant-template/templates/*/; do
  tmpl_name=$(basename "$tmpl")
  npx wrangler pages deploy "$tmpl" --project-name "$PAGES_PROJECT" --branch main >/dev/null 2>&1 \
    && info "  模板 $tmpl_name ✓" || warn "  模板 $tmpl_name 部署失败"
done

# ── 11. 回注册到中央后台 ──
PAGES_URL="https://${PAGES_PROJECT}.pages.dev"
REGISTER_TOKEN="${ADMIN_TOKEN:-$MERCHANT_TOKEN}"
info "回注册到中央后台..."
curl -s -X POST "${CENTRAL_AUTH_URL}/api/merchants/${MERCHANT_ID}/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${REGISTER_TOKEN}" \
  -d "{\"version\":\"$(date +%Y%m%d.%H%M)\",\"workerUrl\":\"${WORKER_URL}\",\"pagesUrl\":\"${PAGES_URL}\"}" \
  >/dev/null 2>&1 || warn "  回注册失败（可手动注册）"

echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  商户部署完成!${NC}"
echo -e "${GREEN}  Merchant ID: ${MERCHANT_ID}${NC}"
echo -e "${GREEN}  Worker URL:  ${WORKER_URL:-<未知>}${NC}"
echo -e "${GREEN}  Store URL:   ${PAGES_URL}${NC}"
echo -e "${GREEN}  后台初始化:  POST ${WORKER_URL}/api/auth/setup (X-Setup-Token: MERCHANT_TOKEN)${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
