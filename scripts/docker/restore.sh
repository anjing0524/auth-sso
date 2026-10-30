#!/usr/bin/env bash
#
# 从 pg_dump 备份恢复生产数据库（危险操作，必须显式 --yes）。
#
# 用法：
#   ./scripts/docker/restore.sh backups/auth-sso-YYYYmmdd-HHMMSS.dump --yes
#
# 行为：
#   1. 校验 dump 可读；
#   2. 自动为当前库再做一次备份（BACKUP_DIR，失败则中止）；
#   3. 停 Portal/Gateway → 隔离库 pg_restore → 原子换名 → 清 Redis → 启动 → 健康检查。
#
# 环境变量：SKIP_REDIS_FLUSH=1 可跳过 Redis 清理（不推荐）。
#
# 环境变量：ENV_FILE / COMPOSE_FILE / BACKUP_DIR 同 backup.sh。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DUMP="${1:-}"
YES="${2:-}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/compose/prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"

if [[ -z "$DUMP" || "$YES" != "--yes" ]]; then
  echo "用法：$0 <backup.dump> --yes" >&2
  exit 2
fi
[[ -s "$DUMP" ]] || { echo "✗ 备份文件不存在或为空：$DUMP" >&2; exit 1; }

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
docker compose version >/dev/null 2>&1 || { echo "未安装 Docker Compose v2" >&2; exit 1; }

echo "▶ 校验 dump"
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$DUMP" >/dev/null

echo "▶ 恢复前先备份当前库"
COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" BACKUP_DIR="$BACKUP_DIR" "$ROOT/scripts/docker/backup.sh"

echo "▶ 停止 Portal/Gateway（保留 PostgreSQL）"
"${COMPOSE[@]}" stop portal gateway >/dev/null

RESTORE_DB="auth_sso_restore"
echo "▶ 恢复到隔离库 ${RESTORE_DB}（失败不影响现网库）"
"${COMPOSE[@]}" exec -T postgres sh -c 'dropdb --if-exists -U "${POSTGRES_USER:-postgres}" auth_sso_restore; createdb -U "${POSTGRES_USER:-postgres}" auth_sso_restore'
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_restore -U "${POSTGRES_USER:-postgres}" -d auth_sso_restore --no-owner --no-privileges' < "$DUMP"
"${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "${POSTGRES_USER:-postgres}" -d auth_sso_restore -tAc "SELECT count(*) FROM users" >/dev/null'

echo "▶ 校验通过，原子切换数据库"
"${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "${POSTGRES_USER:-postgres}" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE auth_sso" -c "ALTER DATABASE auth_sso_restore RENAME TO auth_sso"'

if [[ "${SKIP_REDIS_FLUSH:-0}" != "1" ]]; then
  echo "▶ 清空 Redis 会话/权限缓存（避免恢复后旧会话仍有效）"
  "${COMPOSE[@]}" exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" FLUSHALL' >/dev/null
fi

echo "▶ 启动 Portal/Gateway"
"${COMPOSE[@]}" up -d portal gateway

echo "▶ 等待 Portal 健康"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T portal node -e 'fetch("http://127.0.0.1:4000/api/health").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    echo "✅ 恢复完成，Portal 健康"
    exit 0
  fi
  sleep 2
done
echo "✗ Portal 未在 120s 内恢复健康，请查看日志" >&2
exit 1
