#!/usr/bin/env bash
#
# 本地数据重置：删除本地 PG/Redis 数据卷 → 启动基础设施 → migrate + seed。
#
# 注意：只影响 docker/compose/local.yml 的命名卷，不影响验收栈/生产。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/auth_sso}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

"$ROOT/scripts/local/infra.sh" reset
echo "▶ 应用迁移"
pnpm --filter @auth-sso/portal db:migrate
echo "▶ 重新 seed"
pnpm --filter @auth-sso/portal db:seed
echo "✅ 本地数据已重置；运行 pnpm dev 启动"
