#!/usr/bin/env bash
#
# 本地原生启动：本地 PG/Redis + 迁移 + Next dev（4100）。
#
# 这是开发入口，不是验收入口；验收/部署仍用 Docker：
#   pnpm test:e2e / pnpm stack:*（验收）
#   pnpm deploy:up（生产）
#
# 用法：
#   ./scripts/local/dev.sh            # 启动基础设施 + migrate + Next dev
#   ./scripts/local/dev.sh --reset    # 先删本地数据卷 + migrate + seed，再启动
#   ./scripts/local/dev.sh --no-migrate
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

RESET=0
MIGRATE=1
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --no-migrate) MIGRATE=0 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $arg（--help 查看用法）" >&2; exit 2 ;;
  esac
done

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/auth_sso}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:4100}"
export PORTAL_ISSUER="${PORTAL_ISSUER:-http://localhost:4100}"

if (( RESET )); then
  "$ROOT/scripts/local/infra.sh" reset
else
  "$ROOT/scripts/local/infra.sh" up
fi

if (( MIGRATE )); then
  echo "▶ 应用本地数据库迁移"
  pnpm --filter @auth-sso/portal db:migrate
fi

if (( RESET )); then
  echo "▶ 重新 seed 本地数据"
  pnpm --filter @auth-sso/portal db:seed
fi

echo "▶ 启动 Portal dev：$NEXT_PUBLIC_APP_URL"
exec pnpm --filter @auth-sso/portal dev
