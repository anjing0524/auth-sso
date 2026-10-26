#!/usr/bin/env bash
#
# CI 发布验收：复用 stack.sh 起验收栈 → 在 Playwright 官方镜像内跑 tests/e2e 全部 spec → 收日志 → 清理。
#
# 与本地 `pnpm test:e2e`（scripts/e2e/release.sh）是**同一条验收路径**：同一份 compose、同一服务列表
# （都由 scripts/docker/stack.sh 管理）、同一 base URL；差别只在**浏览器运行器**：
#   - 本地用宿主已安装的 Playwright；CI 没有宿主依赖，改在官方镜像里执行；
#   - 浏览器必须与测试在**同一个容器**里安装：Playwright 镜像自带浏览器版本由镜像决定，
#     与 lockfile 里的 @playwright/test 版本不一致时会报
#     `Executable doesn't exist at /ms-playwright/chromium_headless_shell-…`；
#     `--rm` 容器的可写层随容器销毁，所以 install 与 test 必须在同一条 `docker run` 里。
#
# 产物（由 workflow 上传）：gateway-e2e.log、playwright-report/、test-results/
# 退出码即结论：任一步失败非零退出；清理在 trap 里做，日志**始终**收集。
#
# 环境变量：E2E_BASE_URL（默认 https://127.0.0.1:19443）
#           PLAYWRIGHT_IMAGE（默认 mcr.microsoft.com/playwright:v1.60.0-noble）
#
# 本脚本只被 .github/workflows/acceptance.yml 调用（本地入口是 `pnpm test:e2e`）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

readonly E2E_BASE_URL="${E2E_BASE_URL:-https://127.0.0.1:19443}"
readonly PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.60.0-noble}"
readonly STACK="./scripts/docker/stack.sh"
readonly COMPOSE_FILE="docker/compose/test.yml"
readonly LOG_FILE="gateway-e2e.log"

cleanup() {
  # 先收日志再停机，保证失败现场（栈日志）一定进 artifact
  docker compose -f "$COMPOSE_FILE" logs --no-color >"$LOG_FILE" 2>&1 || true
  "$STACK" down >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$STACK" up --build

# 容器内先装 pnpm（镜像只带 node/npm），再按 lockfile 装依赖与 Chromium，最后跑全部 spec。
docker run --rm --network host \
  -v "$ROOT:/work" -w /work \
  -e E2E_TARGET=docker \
  -e E2E_BASE_URL="$E2E_BASE_URL" \
  -e E2E_SKIP_SEED=true \
  "$PLAYWRIGHT_IMAGE" \
  bash -lc "npm install -g pnpm@10.12.4 &&
    printf 'manage-package-manager-versions=false\nregistry=https://registry.npmmirror.com\n' > .npmrc &&
    pnpm install --frozen-lockfile &&
    pnpm exec playwright install chromium &&
    pnpm exec playwright test tests/e2e"
