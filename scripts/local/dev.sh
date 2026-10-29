#!/usr/bin/env bash
#
# 本地原生启动：本地 PG18/Redis8 + 迁移 + Next dev（4100）。
#
# 这是唯一本地入口；基础设施用标准 docker compose，不再包一层 infra 脚本。
#   pnpm dev                 # 启动本地依赖 + migrate + Next dev
#   pnpm dev -- --reset      # 删本地数据卷 + migrate + seed，再启动
#   pnpm dev -- --no-migrate # 跳过迁移
#
# 验收/生产是另外两条命令：pnpm test:e2e / pnpm deploy。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

RESET=0
MIGRATE=1
for arg in "$@"; do
  case "$arg" in
    --) ;; # pnpm 的 `--` 参数分隔符
    --reset) RESET=1 ;;
    --no-migrate) MIGRATE=0 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: ${arg}（--help 查看用法）" >&2; exit 2 ;;
  esac
done

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/auth_sso}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:4100}"
export PORTAL_ISSUER="${PORTAL_ISSUER:-http://localhost:4100}"

COMPOSE=(docker compose -f docker/compose/local.yml)

if (( RESET )); then
  "${COMPOSE[@]}" down -v --remove-orphans
fi
"${COMPOSE[@]}" up -d --wait postgres redis
"${COMPOSE[@]}" ps

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
