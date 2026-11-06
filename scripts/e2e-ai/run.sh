#!/usr/bin/env bash
#
# Midscene 探索性 AI 视觉测试（非阻断）。
#
# 模型默认使用 DSH 中配置的 DeepSeek：
#   ~/.dsh/.credentials.yaml 的 DEEPSEEK_API_KEY → MIDSCENE_MODEL_API_KEY
# 也支持显式环境变量覆盖。没有密钥时直接 skip 并以 0 退出。
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${MIDSCENE_MODEL_API_KEY:-}" ]]; then
  if [[ -f "${DSH_CREDENTIALS_FILE:-$HOME/.dsh/.credentials.yaml}" ]]; then
    MIDSCENE_MODEL_API_KEY="$(python3 - <<'PY'
import re
s = open(__import__('os').path.expanduser('~/.dsh/.credentials.yaml')).read()
m = re.search(r'DEEPSEEK_API_KEY:\s*(\S+)', s)
print(m.group(1) if m else '')
PY
)"
  fi
fi

if [[ -z "${MIDSCENE_MODEL_API_KEY:-}" ]]; then
  echo "▶ 未找到 DSH/DEEPSEEK API Key，跳过 Midscene 试点"
  exit 0
fi
export MIDSCENE_MODEL_API_KEY

export MIDSCENE_MODEL_BASE_URL="${MIDSCENE_MODEL_BASE_URL:-https://api.deepseek.com}"
export MIDSCENE_MODEL_NAME="${MIDSCENE_MODEL_NAME:-deepseek-flash}"
export MIDSCENE_MODEL_FAMILY="${MIDSCENE_MODEL_FAMILY:-deepseek}"
export E2E_BASE_URL="${E2E_BASE_URL:-https://127.0.0.1:19443}"
export E2E_CHANNEL="${E2E_CHANNEL:-chrome}"

echo "▶ Midscene AI 视觉测试：${E2E_BASE_URL}（模型 ${MIDSCENE_MODEL_NAME}，非阻断）"
exec "$ROOT/node_modules/.bin/playwright" test --config tests/e2e-ai/playwright.config.ts "$@"
