#!/usr/bin/env bash
# ============================================================
# update-all.sh — 批量更新所有商户的 Worker（含迁移）
# ============================================================
# 用法:
#   ./update-all.sh \
#     --central-url=https://rose-saas-central-api.xxx.workers.dev \
#     --admin-token=<中央管理员Token> \
#     --tokens-file=./merchant-tokens.json \
#     [--version=20260901]
#
# merchant-tokens.json 格式（每个商户的 CF API Token，因 API 会脱敏故需本地提供）:
#   {
#     "m-abc123": { "email": "owner@x.com", "token": "cf_api_token_xxx" },
#     "m-def456": { "token": "cf_api_token_yyy" }
#   }

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

CENTRAL_URL=""; ADMIN_TOKEN=""; TOKENS_FILE=""; VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --central-url) CENTRAL_URL="$2"; shift 2 ;;
    --admin-token) ADMIN_TOKEN="$2"; shift 2 ;;
    --tokens-file) TOKENS_FILE="$2"; shift 2 ;;
    --version)     VERSION="$2";     shift 2 ;;
    *) error "未知参数: $1" ;;
  esac
done

[[ -z "$CENTRAL_URL" ]] && error "缺少 --central-url"
[[ -z "$ADMIN_TOKEN" ]] && error "缺少 --admin-token"
[[ -z "$TOKENS_FILE" || ! -f "$TOKENS_FILE" ]] && error "缺少或找不到 --tokens-file"
command -v jq >/dev/null 2>&1 || error "需要 jq"

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${VERSION:-$(date +%Y%m%d.%H%M)}"

info "获取 active 商户列表..."
MERCHANTS=$(curl -s "${CENTRAL_URL}/api/merchants?status=active" -H "Authorization: Bearer ${ADMIN_TOKEN}")
COUNT=$(echo "$MERCHANTS" | jq -r '.merchants | length' 2>/dev/null || echo 0)
[[ "$COUNT" == "0" ]] && { warn "没有 active 商户"; exit 0; }

echo "$MERCHANTS" | jq -c '.merchants[]' | while read -r merchant; do
  MID=$(echo "$merchant" | jq -r '.id')
  NAME=$(echo "$merchant" | jq -r '.name')
  CF_TOKEN=$(jq -r --arg id "$MID" '.[$id].token // empty' "$TOKENS_FILE")
  CF_EMAIL=$(jq -r --arg id "$MID" '.[$id].email // empty' "$TOKENS_FILE")

  info "更新商户: $NAME ($MID)"
  if [[ -z "$CF_TOKEN" ]]; then
    warn "  跳过: tokens-file 中缺少该商户的 CF Token"
    continue
  fi

  # 1. 迁移（幂等）
  bash "$SCRIPT_DIR/scripts/migrate-merchant.sh" \
    --db-name "restaurant-${MID}" --cf-api-token "$CF_TOKEN" ${CF_EMAIL:+--cf-email "$CF_EMAIL"} \
    && info "  迁移完成 ✓" || warn "  迁移失败"

  # 2. 部署 Worker（使用商户账号）
  if CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_EMAIL="${CF_EMAIL:-}" \
     npx wrangler deploy --config "$SCRIPT_DIR/merchant-template/worker/wrangler.jsonc" \
       --name "restaurant-api-${MID}" >/dev/null 2>&1; then
    info "  Worker 部署 ✓"
  else
    warn "  Worker 部署失败"
  fi

  # 3. 回注册
  curl -s -X POST "${CENTRAL_URL}/api/merchants/${MID}/deployments" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -d "{\"version\":\"${VERSION}\",\"status\":\"success\"}" >/dev/null 2>&1 || warn "  回注册失败"
done

echo ""
info "全量更新完成"
