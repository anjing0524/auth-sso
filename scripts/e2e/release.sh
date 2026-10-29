#!/usr/bin/env bash
#
# 发布验收 e2e：构建并启动 docker/compose/test.yml，跑 tests/e2e，然后清理。
#
# 这是 `pnpm test:e2e` 的唯一实现，直接操作 compose，不再经过额外包装层。
#
# 环境变量：
#   SKIP_BUILD=1     复用已构建镜像
#   E2E_KEEP_STACK=1 跑完保留栈（默认 down --volumes）
#   E2E_BASE_URL=... 默认 https://127.0.0.1:19443
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export BUILDX_CONFIG="${BUILDX_CONFIG:-$ROOT/.tmp-buildx}"
mkdir -p "$BUILDX_CONFIG"
export E2E_BASE_URL="${E2E_BASE_URL:-https://127.0.0.1:19443}"

COMPOSE=(docker compose -f docker/compose/test.yml)
SERVICES=(postgres redis cert-init db-init portal gateway)

cleanup() {
  if [[ "${E2E_KEEP_STACK:-0}" == "1" ]]; then
    echo "▶ E2E_KEEP_STACK=1：保留验收栈（docker compose -f docker/compose/test.yml down --volumes 可清理）"
    return 0
  fi
  "${COMPOSE[@]}" down --volumes --remove-orphans
}
trap cleanup EXIT

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "▶ 构建验收镜像"
  "${COMPOSE[@]}" build "${SERVICES[@]}"
fi

echo "▶ 启动验收栈"
"${COMPOSE[@]}" up -d --wait --wait-timeout 600 "${SERVICES[@]}"

echo "▶ 执行 E2E：$E2E_BASE_URL"
E2E_TARGET=docker E2E_SKIP_SEED=true E2E_BASE_URL="$E2E_BASE_URL" \
  "$ROOT/node_modules/.bin/playwright" test tests/e2e "$@"
