#!/usr/bin/env bash
#
# 统一 Docker 入口 —— **构建 / 启动 / 状态 / 日志 / 停机 / 验收 e2e** 都从这里进。
#
# 背景：本仓此前有 4 个 compose 文件、5 个 docker 相关脚本、若干根 package.json 命令，
# 用法散落在 AGENTS.md/docs/roadmap 里；排查"到底用哪条命令"的成本比问题本身还高。
# 本脚本把 release/acceptance 栈（docker-compose.test.yml）的生命周期收敛成一个入口。
#
# 用法：
#   ./scripts/stack.sh up              # 启动（复用已构建镜像；缺镜像会提示先 build）
#   ./scripts/stack.sh up --build      # 先构建再启动
#   ./scripts/stack.sh build           # 只构建（portal/gateway/cert-init/db-init）
#   ./scripts/stack.sh status          # 服务状态
#   ./scripts/stack.sh logs [service]  # 跟随日志（不传 service 则全部）
#   ./scripts/stack.sh e2e [--build]   # 启动并跑 tests/e2e 全部 spec（不自动停机）
#   ./scripts/stack.sh down            # 停机（保留卷）
#   ./scripts/stack.sh clean           # 停机 + 删卷 + 删本仓镜像
#
# 环境变量：
#   COMPOSE_FILE=...     默认 docker-compose.test.yml（其余 compose 见 docs/docker.md）
#   WAIT_TIMEOUT=600     等待健康检查的上限秒数
#   BUILDX_CONFIG=...    默认 <repo>/.tmp-buildx —— 某些沙箱/CI 里 ~/.docker/buildx 只读，
#                        必须重定向，否则 build 直接报 `read-only file system`
#   E2E_BASE_URL=...     默认 https://127.0.0.1:19443
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-600}"
E2E_BASE_URL="${E2E_BASE_URL:-https://127.0.0.1:19443}"
SERVICES=(postgres redis cert-init db-init portal gateway)

# buildx 配置目录：容器内/沙箱里 HOME 可能只读，默认路径会让 build 失败
export BUILDX_CONFIG="${BUILDX_CONFIG:-$ROOT/.tmp-buildx}"
mkdir -p "$BUILDX_CONFIG"

compose() { docker compose -f "$ROOT/$COMPOSE_FILE" "$@"; }

usage() { sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

cmd_build() {
  echo "▶ 构建镜像（$COMPOSE_FILE: ${SERVICES[*]}）"
  compose build "${SERVICES[@]}"
}

cmd_up() {
  local build=0
  [[ "${1:-}" == "--build" ]] && build=1
  if [[ "$build" == "1" ]]; then cmd_build; fi
  echo "▶ 启动并等待健康（timeout ${WAIT_TIMEOUT}s）"
  compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" "${SERVICES[@]}"
  compose ps
}

cmd_e2e() {
  local build=0
  [[ "${1:-}" == "--build" ]] && build=1
  if [[ "$build" == "1" ]]; then cmd_build; fi
  compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" "${SERVICES[@]}"
  echo "▶ 验收 e2e：$E2E_BASE_URL"
  E2E_TARGET=docker E2E_BASE_URL="$E2E_BASE_URL" E2E_SKIP_SEED=true \
    # 跑 tests/e2e 下全部 spec（新增的边界/健康探针回归也进入发布验收）
    "$ROOT/node_modules/.bin/playwright" test tests/e2e "${@:2}"
}

case "${1:-help}" in
  up)      cmd_up "${2:-}" ;;
  build)   cmd_build ;;
  status)  compose ps ;;
  logs)    shift; compose logs --no-color -f "$@" ;;
  e2e)     shift; cmd_e2e "$@" ;;
  down)    compose down --volumes --remove-orphans ;;
  clean)   compose down --volumes --remove-orphans --rmi local ;;
  help|-h|--help) usage ;;
  *) echo "未知命令：$1（可用：up|build|status|logs|e2e|down|clean）" >&2; usage >&2; exit 2 ;;
esac
