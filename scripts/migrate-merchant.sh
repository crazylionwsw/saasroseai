#!/usr/bin/env bash
# ============================================================
# migrate-merchant.sh — 对商户 D1 执行 schema 与迁移（幂等）
# ============================================================
# 用法:
#   ./migrate-merchant.sh --db-name=restaurant-m-abc \
#     [--cf-api-token=xxxx] [--cf-email=a@b.com] [--local]
#
# 逻辑:
#   - 首次部署(无 merchant_info 表): 执行 schema.sql（已含全部列），
#     并将所有迁移标记为已应用。
#   - 已存在: 按序执行 migrations/*.sql 中尚未应用的迁移。
#   - 迁移记录表: _migrations(name PRIMARY KEY, applied_at)
#
# 需要 jq 与 wrangler。

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[migrate]${NC} $1"; }
warn()  { echo -e "${YELLOW}[migrate]${NC} $1"; }
error() { echo -e "${RED}[migrate]${NC} $1"; exit 1; }

DB_NAME=""; CF_API_TOKEN=""; CF_EMAIL=""; LOCAL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-name)      DB_NAME="$2";      shift 2 ;;
    --cf-api-token) CF_API_TOKEN="$2"; shift 2 ;;
    --cf-email)     CF_EMAIL="$2";     shift 2 ;;
    --local)        LOCAL=1;           shift 1 ;;
    *) error "未知参数: $1" ;;
  esac
done

[[ -z "$DB_NAME" ]] && error "缺少 --db-name"
command -v jq >/dev/null 2>&1 || error "需要 jq"

if [[ -n "$CF_API_TOKEN" ]]; then export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"; fi
if [[ -n "$CF_EMAIL" ]]; then export CLOUDFLARE_EMAIL="$CF_EMAIL"; fi

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_DIR="$SCRIPT_DIR/merchant-template/worker"
MIGRATIONS_DIR="$WORKER_DIR/migrations"

REMOTE_FLAG="--remote"; [[ "$LOCAL" == "1" ]] && REMOTE_FLAG="--local"
WRANGLER_CONFIG="$WORKER_DIR/wrangler.jsonc"

run_file() { npx wrangler d1 execute "$DB_NAME" $REMOTE_FLAG --config "$WRANGLER_CONFIG" --file "$1" -y >/dev/null 2>&1; }
run_cmd()  { npx wrangler d1 execute "$DB_NAME" $REMOTE_FLAG --config "$WRANGLER_CONFIG" --command "$1" -y >/dev/null 2>&1; }
query()    { npx wrangler d1 execute "$DB_NAME" $REMOTE_FLAG --config "$WRANGLER_CONFIG" --json --command "$1" -y 2>/dev/null | jq -r '.[0].results'; }

info "目标数据库: $DB_NAME ($REMOTE_FLAG)"

# 1. 迁移记录表
run_cmd "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')));" \
  || error "无法创建 _migrations 表（检查 D1 名称与凭据）"

# 2. 判断是否全新库
HAS_MERCHANT_INFO=$(query "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='merchant_info';" | jq -r '.[0].c // 0')

if [[ "$HAS_MERCHANT_INFO" == "0" ]]; then
  info "全新数据库：执行 schema.sql"
  run_file "$WORKER_DIR/schema.sql" || error "schema.sql 执行失败"
  # 标记全部迁移为已应用
  if [[ -d "$MIGRATIONS_DIR" ]]; then
    for f in "$MIGRATIONS_DIR"/*.sql; do
      [[ -e "$f" ]] || continue
      name=$(basename "$f")
      run_cmd "INSERT OR IGNORE INTO _migrations (name) VALUES ('$name');"
    done
    info "已将 $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ') 个迁移标记为已应用"
  fi
else
  # 若数据库已包含合并后的 schema（如直接执行过新版 schema.sql），
  # 则将全部迁移标记为已应用，避免重复执行破坏性迁移（如 006 重建 orders）。
  HAS_CENTS=$(query "SELECT COUNT(*) as c FROM pragma_table_info('orders') WHERE name='subtotal_cents';" | jq -r '.[0].c // 0')
  MIG_COUNT=$(query "SELECT COUNT(*) as c FROM _migrations;" | jq -r '.[0].c // 0')
  if [[ "$HAS_CENTS" != "0" && "$MIG_COUNT" == "0" ]]; then
    info "检测到已含合并 schema：标记全部迁移为已应用"
    for f in "$MIGRATIONS_DIR"/*.sql; do
      [[ -e "$f" ]] || continue
      run_cmd "INSERT OR IGNORE INTO _migrations (name) VALUES ('$(basename "$f")');"
    done
  else
    info "已存在数据库：执行增量迁移"
    applied=0
    if [[ -d "$MIGRATIONS_DIR" ]]; then
      for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
        name=$(basename "$f")
        done_count=$(query "SELECT COUNT(*) as c FROM _migrations WHERE name='$name';" | jq -r '.[0].c // 0')
        if [[ "$done_count" != "0" ]]; then
          continue
        fi
        info "  应用迁移: $name"
        if run_file "$f"; then
          run_cmd "INSERT OR IGNORE INTO _migrations (name) VALUES ('$name');"
          applied=$((applied + 1))
        else
          warn "  迁移失败: $name（可能已手动应用，继续）"
        fi
      done
    fi
    info "本次应用迁移数: $applied"
  fi
fi

# 3. 校验关键表
for t in merchant_info orders payments payment_events carts tax_rules staff_users payment_accounts; do
  c=$(query "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='$t';" | jq -r '.[0].c // 0')
  if [[ "$c" == "0" ]]; then warn "缺少表: $t"; else info "  ✓ $t"; fi
done

info "迁移完成 ✅"
