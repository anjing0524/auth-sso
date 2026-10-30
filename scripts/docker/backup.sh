#!/usr/bin/env bash
#
# PostgreSQL 逻辑备份（生产默认 prod.yml；测试/验收可用 COMPOSE_FILE 覆盖）。
#
# 用法：
#   ./scripts/docker/backup.sh                 # 数据库必须在运行；失败则非零退出
#   ./scripts/docker/backup.sh --if-running    # 数据库未运行则跳过（首次部署用）
#
# 环境变量：
#   ENV_FILE=.env.prod
#   COMPOSE_FILE=docker/compose/prod.yml
#   BACKUP_DIR=<repo>/backups
#   BACKUP_ENCRYPTION_KEY_FILE=...  可选；设置后输出 .dump.enc（AES-256-CBC/PBKDF2）
#
# 产物：auth-sso-YYYYmmdd-HHMMSS.dump[.enc] + .sha256；pg_restore --list 校验通过才算成功。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/compose/prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:-}"
IF_RUNNING=0
[[ "${1:-}" == "--if-running" ]] && IF_RUNNING=1

command -v docker >/dev/null 2>&1 || { echo "未安装 Docker" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "未安装 Docker Compose v2" >&2; exit 1; }

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
if ! "${COMPOSE[@]}" ps -q postgres >/dev/null 2>&1; then
  if (( IF_RUNNING )); then
    echo "▶ PostgreSQL 未运行，跳过备份（首次部署）"
    exit 0
  fi
  echo "✗ PostgreSQL 未运行，无法备份" >&2
  exit 1
fi
if [[ -z "$("${COMPOSE[@]}" ps -q postgres)" ]]; then
  if (( IF_RUNNING )); then
    echo "▶ PostgreSQL 容器不存在，跳过备份（首次部署）"
    exit 0
  fi
  echo "✗ PostgreSQL 容器不存在，无法备份" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/auth-sso-$STAMP.dump"
TMP="$OUT.tmp"

echo "▶ 备份 PostgreSQL → $OUT"
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "${POSTGRES_USER:-postgres}" -d auth_sso -Fc' > "$TMP"
[[ -s "$TMP" ]] || { rm -f "$TMP"; echo "✗ 备份文件为空" >&2; exit 1; }
mv "$TMP" "$OUT"
chmod 600 "$OUT"

echo "▶ 校验备份可读"
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$OUT" >/dev/null

if [[ -n "$KEY_FILE" ]]; then
  [[ -r "$KEY_FILE" ]] || { rm -f "$OUT"; echo "✗ 备份密钥文件不可读：$KEY_FILE" >&2; exit 1; }
  command -v openssl >/dev/null 2>&1 || { rm -f "$OUT"; echo "✗ 需要 openssl 加密备份" >&2; exit 1; }
  echo "▶ AES-256 加密备份"
  ENC="$OUT.enc"
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass "file:$KEY_FILE" -in "$OUT" -out "$ENC"
  rm -f "$OUT"
  OUT="$ENC"
fi

if command -v sha256sum >/dev/null 2>&1; then sha256sum "$OUT" > "$OUT.sha256"; else shasum -a 256 "$OUT" > "$OUT.sha256"; fi
chmod 600 "$OUT" "$OUT.sha256"
echo "✅ 备份完成：$OUT"
[[ -n "$KEY_FILE" ]] && echo "   恢复需同一 BACKUP_ENCRYPTION_KEY_FILE"
