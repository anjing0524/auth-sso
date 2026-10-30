#!/usr/bin/env bash
#
# Auth-SSO 生产部署脚本（唯一入口，配套 docker/compose/prod.yml）
#
# 设计目标：
# 1. **一条命令完成可复现部署**：环境校验 → Compose 配置校验 → 构建 → 迁移/seed → 启动 → 健康检查；
# 2. **失败不假装成功**：任何一步失败立即退出并打印最近日志，不自动删数据/不自动回滚；
# 3. **可回滚**：部署前给现有镜像打 `:previous` 标签，`--rollback` 直接切回（数据备份需运维负责）。
#
# 用法：
#   ./scripts/docker/deploy.sh                  # 首次/升级部署（构建 + 迁移 + 启动 + 健康检查）
#   ./scripts/docker/deploy.sh --no-build       # 使用当前镜像部署（不构建）
#   ./scripts/docker/deploy.sh --check          # 只校验 .env.prod 必填项与 compose 配置，不启动
#   ./scripts/docker/deploy.sh --status         # 查看容器状态与最近健康
#   ./scripts/docker/deploy.sh --rollback       # 切回上次部署的镜像（:previous）
#   ./scripts/docker/deploy.sh --down           # 停止服务（保留数据卷）
#
# 环境变量：
#   ENV_FILE=...       默认 .env.prod
#   COMPOSE_FILE=...   默认 docker/compose/prod.yml
#   WAIT_PORTAL_SECS   默认 120
#   WAIT_GATEWAY_SECS  默认 300（首次 ACME 签发可能较慢）
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/compose/prod.yml}"
WAIT_PORTAL_SECS="${WAIT_PORTAL_SECS:-120}"
WAIT_GATEWAY_SECS="${WAIT_GATEWAY_SECS:-300}"
PORTAL_IMAGE="auth-sso-portal:latest"
GATEWAY_IMAGE="auth-sso-gateway:latest"
PREV_TAG="previous"

MODE="deploy"
NO_BUILD=0
for arg in "$@"; do
  case "${arg}" in
    --check) MODE="check" ;;
    --no-build) NO_BUILD=1 ;;
    --status) MODE="status" ;;
    --rollback) MODE="rollback" ;;
    --down) MODE="down" ;;
    -h|--help|help) MODE="help" ;;
    *) echo "未知参数: ${arg}（--help 查看用法）" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "未安装 Docker"
  docker compose version >/dev/null 2>&1 || fail "未安装 Docker Compose v2（docker compose）"
}

if [[ "${MODE}" == "help" ]]; then
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

require_docker

COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

compose() { "${COMPOSE[@]}" "$@"; }

# ── 1. 环境文件与必填项校验 ────────────────────────────────────────────────
check_env() {
  [[ -f "${ENV_FILE}" ]] || fail "缺少 ${ENV_FILE}：请先 cp .env.example ${ENV_FILE} 并填写生产参数"

  local required=(
    POSTGRES_PASSWORD REDIS_PASSWORD
    NEXT_PUBLIC_APP_URL PORTAL_CLIENT_SECRET
    PORTAL_REDIRECT_URL GATEWAY_SHARED_SECRET
    LETSENCRYPT_DOMAIN LETSENCRYPT_EMAIL
  )
  local missing=() key value
  for key in "${required[@]}"; do
    value="$(grep -E "^${key}=.+" "${ENV_FILE}" | tail -1 | cut -d= -f2- || true)"
    if [[ -z "${value//[[:space:]]/}" ]]; then missing+=("${key}"); fi
  done
  if (( ${#missing[@]} > 0 )); then
    fail "缺少必填环境变量: ${missing[*]}（见 docs/docker.md §3 与 .env.example）"
  fi

  local domain
  domain="$(grep -E '^LETSENCRYPT_DOMAIN=.+' "${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
  [[ "${domain}" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail "LETSENCRYPT_DOMAIN 不是合法域名: ${domain:-<空>}"

  grep -qE '^(NEXT_PUBLIC_APP_URL|PORTAL_REDIRECT_URL)=https://' "${ENV_FILE}" \
    || fail "NEXT_PUBLIC_APP_URL / PORTAL_REDIRECT_URL 必须为 https://"

  log "环境文件校验通过：${ENV_FILE}（domain=${domain}）"
}

check_compose_config() {
  compose config --quiet || fail "docker compose 配置校验失败（先修正 ${COMPOSE_FILE} / ${ENV_FILE}）"
  log "Compose 配置校验通过：${COMPOSE_FILE}"
}

# ── 2. 镜像准备 / 回滚 ─────────────────────────────────────────────────────
tag_previous_images() {
  if docker image inspect "${PORTAL_IMAGE}" >/dev/null 2>&1; then
    docker tag "${PORTAL_IMAGE}" "auth-sso-portal:${PREV_TAG}"
    log "已备份当前 Portal 镜像 → auth-sso-portal:${PREV_TAG}"
  fi
  if docker image inspect "${GATEWAY_IMAGE}" >/dev/null 2>&1; then
    docker tag "${GATEWAY_IMAGE}" "auth-sso-gateway:${PREV_TAG}"
    log "已备份当前 Gateway 镜像 → auth-sso-gateway:${PREV_TAG}"
  fi
}

build_images() {
  log "构建镜像（portal + gateway）…"
  compose build || fail "镜像构建失败"
}

# ── 3. 健康检查 ────────────────────────────────────────────────────────────
wait_portal() {
  log "等待 Portal 健康检查（≤${WAIT_PORTAL_SECS}s）…"
  local deadline=$((SECONDS + WAIT_PORTAL_SECS))
  while (( SECONDS < deadline )); do
    if compose exec -T portal node -e 'fetch("http://127.0.0.1:4000/api/health").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
      log "Portal 健康 ✅"; return 0
    fi
    sleep 2
  done
  compose logs --no-color --tail 40 portal || true
  fail "Portal 在 ${WAIT_PORTAL_SECS}s 内未通过健康检查"
}

wait_gateway() {
  local domain
  domain="$(grep -E '^LETSENCRYPT_DOMAIN=.+' "${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
  if ! command -v curl >/dev/null 2>&1; then
    warn "未安装 curl，跳过 Gateway HTTPS 健康检查（请手工验证 https://${domain}/login）"
    return 0
  fi
  log "等待 Gateway 存活探针 /healthz…"
  local live_deadline=$((SECONDS + 60))
  while (( SECONDS < live_deadline )); do
    if curl -sk --max-time 3 --resolve "${domain}:443:127.0.0.1" -o /dev/null "https://${domain}/healthz" 2>/dev/null; then break; fi
    sleep 2
  done

  log "等待 Gateway HTTPS 就绪（≤${WAIT_GATEWAY_SECS}s，首次 ACME 签发可能较慢）…"
  local deadline=$((SECONDS + WAIT_GATEWAY_SECS)) code
  while (( SECONDS < deadline )); do
    code="$(curl -sk --max-time 5 --resolve "${domain}:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://${domain}/login" 2>/dev/null || true)"
    if [[ "${code}" == "200" ]]; then log "Gateway HTTPS 健康 ✅ https://${domain}/login"; return 0; fi
    sleep 5
  done
  compose logs --no-color --tail 60 gateway || true
  fail "Gateway 在 ${WAIT_GATEWAY_SECS}s 内未就绪（ACME/证书/端口请查日志）"
}

# ── 4. 各模式 ──────────────────────────────────────────────────────────────
case "${MODE}" in
  check)
    check_env
    check_compose_config
    log "检查完成：配置可部署（未启动任何容器）"
    ;;
  status)
    check_env
    compose ps
    ;;
  down)
    check_env
    log "停止服务（保留命名卷 gateway_acme 与 ./data 数据目录）…"
    compose down
    log "已停止"
    ;;
  rollback)
    check_env
    docker image inspect "auth-sso-portal:${PREV_TAG}" >/dev/null 2>&1 \
      || fail "没有 auth-sso-portal:${PREV_TAG} 镜像，无法回滚（从未在本脚本中成功部署过）"
    docker image inspect "auth-sso-gateway:${PREV_TAG}" >/dev/null 2>&1 \
      || fail "没有 auth-sso-gateway:${PREV_TAG} 镜像，无法回滚"
    warn "回滚只切镜像；数据库 schema/数据不会回退。请确认已按 docs/docker.md §4.1 备份 data/postgres。"
    docker tag "auth-sso-portal:${PREV_TAG}" "${PORTAL_IMAGE}"
    docker tag "auth-sso-gateway:${PREV_TAG}" "${GATEWAY_IMAGE}"
    compose up -d --no-build
    wait_portal
    wait_gateway
    compose ps
    log "回滚完成"
    ;;
  deploy)
    check_env
    mkdir -p data/postgres data/redis
    tag_previous_images
    check_compose_config
    if (( NO_BUILD == 1 )); then
      log "跳过构建（--no-build）"
    else
      build_images
    fi
    log "启动服务（db-init 会先执行 migrate + seed，Portal 依赖其成功）…"
    if (( NO_BUILD == 1 )); then
      compose up -d --no-build
    else
      compose up -d
    fi
    wait_portal
    wait_gateway
    compose ps
    log "部署完成：https://$(grep -E '^LETSENCRYPT_DOMAIN=.+' "${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '\"')/login"
    ;;
esac
