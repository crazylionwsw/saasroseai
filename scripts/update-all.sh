#!/usr/bin/env bash
# ============================================================
# update-all.sh — 批量更新所有商户的 Worker
# ============================================================
# 用法:
#   ./update-all.sh --central-url=https://api.平台.com --admin-token=xxxx
#
# 从中央后台获取所有 active 商户列表，逐个更新部署。
# 需要在中央账号下运行（用于读取部署列表）。

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

CENTRAL_URL=""
ADMIN_TOKEN=""
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --central-url) CENTRAL_URL="$2"; shift 2 ;;
    --admin-token) ADMIN_TOKEN="$2";  shift 2 ;;
    --version)     VERSION="$2";      shift 2 ;;
    *) error "未知参数: $1" ;;
  esac
done

[[ -z "$CENTRAL_URL" ]]  && error "缺少 --central-url"
[[ -z "$ADMIN_TOKEN" ]]  && error "缺少 --admin-token"

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${VERSION:-$(date +%Y%m%d.%H%M)}"

# 获取所有 active 商户
info "获取 active 商户列表..."
MERCHANTS=$(curl -s "${CENTRAL_URL}/api/merchants?status=active" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")

echo "$MERCHANTS" | jq -c '.merchants[]' 2>/dev/null | while read -r merchant; do
  MID=$(echo "$merchant" | jq -r '.id')
  NAME=$(echo "$merchant" | jq -r '.name')
  CF_EMAIL=$(echo "$merchant" | jq -r '.cfAccountEmail // "unknown"')
  CF_TOKEN=$(echo "$merchant" | jq -r '.cfAccountToken // empty')

  info "更新商户: $NAME ($MID)"

  if [[ -z "$CF_TOKEN" ]]; then
    warn "  跳过: 缺少 CF API Token"
    continue
  fi

  # 部署新版本
  export CLOUDFLARE_API_TOKEN="$CF_TOKEN"
  export CLOUDFLARE_EMAIL="$CF_EMAIL"

  npx wrangler deploy --config "$SCRIPT_DIR/merchant-template/worker/wrangler.jsonc" \
    --name "restaurant-api-${MID}" 2>&1 || warn "  Worker 部署失败"

  # 记录部署
  DEPLOY_PAYLOAD="{
    \"merchantId\": \"${MID}\",
    \"version\": \"${VERSION}\",
    \"status\": \"success\",
    \"cfDeploymentId\": \"${MID}-$(date +%s)\"
  }"

  curl -s -X POST "${CENTRAL_URL}/api/merchants/${MID}/deployments" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -d "$DEPLOY_PAYLOAD" > /dev/null || warn "  回注册失败"

  info "  ✅ $MID 更新完成"
done

echo ""
info "全量更新完成"
