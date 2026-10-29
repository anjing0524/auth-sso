#!/usr/bin/env bash
#
# 本地开发基础设施（PostgreSQL 18 + Redis 8）
#
# 只管理 Docker 依赖，不启动 Portal/Gateway；生产与验收分别走 deploy.sh / stack.sh。
#
# 用法：
#   ./scripts/local/infra.sh up       # 启动并等待健康
#   ./scripts/local/infra.sh down     # 停止（保留数据卷）
#   ./scripts/local/infra.sh reset    # 删除本地数据卷并重启
#   ./scripts/local/infra.sh status   # 状态
#   ./scripts/local/infra.sh logs     # 跟随日志
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/docker/compose/local.yml"
COMPOSE=(docker compose -f "$COMPOSE_FILE")

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

require_docker() {
  command -v docker >/dev/null 2>&1 || { echo "未安装 Docker" >&2; exit 1; }
  docker compose version >/dev/null 2>&1 || { echo "未安装 Docker Compose v2" >&2; exit 1; }
}

case "${1:-help}" in
  up)
    require_docker
    "${COMPOSE[@]}" up -d --wait postgres redis
    "${COMPOSE[@]}" ps
    ;;
  down)
    require_docker
    "${COMPOSE[@]}" down
    ;;
  reset)
    require_docker
    "${COMPOSE[@]}" down -v --remove-orphans
    "${COMPOSE[@]}" up -d --wait postgres redis
    "${COMPOSE[@]}" ps
    ;;
  status)
    require_docker
    "${COMPOSE[@]}" ps
    ;;
  logs)
    require_docker
    shift
    "${COMPOSE[@]}" logs --no-color -f "$@"
    ;;
  help|-h|--help) usage ;;
  *) echo "未知命令：${1:-}（可用：up|down|reset|status|logs）" >&2; exit 2 ;;
esac
