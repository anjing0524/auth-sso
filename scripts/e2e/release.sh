#!/usr/bin/env bash
#
# 发布验收 e2e：在 **Docker 栈** 里跑通「Gateway 登录 → OAuth 回调 → 会话下发 → 登出」闭环。
#
# 这是 `pnpm test:e2e` 的实现；构建/启动逻辑收敛在 scripts/docker/stack.sh（见 docker/README.md）。
#
# 环境变量：
#   SKIP_BUILD=1     复用已构建镜像（镜像已单独 build 过时可加速）
#   E2E_KEEP_STACK=1 跑完**保留**栈（默认跑完 down --volumes，便于重复跑与 CI 清理）
#   E2E_BASE_URL=... 默认 https://127.0.0.1:19443
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export E2E_BASE_URL="${E2E_BASE_URL:-https://127.0.0.1:19443}"

cleanup() {
  if [[ "${E2E_KEEP_STACK:-0}" == "1" ]]; then
    echo "▶ E2E_KEEP_STACK=1：保留 Docker 栈（./scripts/docker/stack.sh down 可清理）"
    return 0
  fi
  "$ROOT/scripts/docker/stack.sh" down
}
trap cleanup EXIT

# 默认构建（保证跑的是当前代码）；SKIP_BUILD=1 时复用镜像
BUILD_FLAG="--build"
[[ "${SKIP_BUILD:-0}" == "1" ]] && BUILD_FLAG=""

"$ROOT/scripts/docker/stack.sh" e2e $BUILD_FLAG "$@"
