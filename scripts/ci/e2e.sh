#!/usr/bin/env bash
#
# CI 发布验收：直接构建并启动 docker/compose/test.yml → 在 Playwright 官方镜像内跑 tests/e2e →
# 收日志 → 清理。与本地 `pnpm test:e2e` 使用同一 compose / 服务列表 / base URL，差别只在浏览器运行器。
#
# 产物：gateway-e2e.log、playwright-report/、test-results/
# 环境变量：E2E_BASE_URL（默认 https://127.0.0.1:19443）
#           PLAYWRIGHT_IMAGE（默认 mcr.microsoft.com/playwright:v1.60.0-noble）
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export BUILDX_CONFIG="${BUILDX_CONFIG:-$ROOT/.tmp-buildx}"
mkdir -p "$BUILDX_CONFIG"

readonly E2E_BASE_URL="${E2E_BASE_URL:-https://127.0.0.1:19443}"
readonly PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.60.0-noble}"
readonly COMPOSE_FILE="docker/compose/test.yml"
readonly LOG_FILE="gateway-e2e.log"
readonly SERVICES=(postgres redis cert-init db-init portal gateway)

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

cleanup() {
  compose logs --no-color >"$LOG_FILE" 2>&1 || true
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

compose build "${SERVICES[@]}"
compose up -d --wait --wait-timeout 600 "${SERVICES[@]}"

docker run --rm --network host \
  -v "$ROOT:/work" -w /work \
  -e E2E_TARGET=docker \
  -e E2E_BASE_URL="$E2E_BASE_URL" \
  -e E2E_SKIP_SEED=true \
  "$PLAYWRIGHT_IMAGE" \
  bash -lc "npm install -g pnpm@12.14.0 &&
    printf 'manage-package-manager-versions=false\nregistry=https://registry.npmmirror.com\n' > .npmrc &&
    pnpm install --frozen-lockfile &&
    pnpm exec playwright install chromium &&
    pnpm exec playwright test tests/e2e"
