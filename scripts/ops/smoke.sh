#!/usr/bin/env bash
#
# 生产/验收环境商业冒烟：HTTPS、登录页、安全头、证书有效期、Gateway metrics。
#
# 用法：
#   BASE_URL=https://sso.example.com GATEWAY_METRICS_TOKEN=... ./scripts/ops/smoke.sh
#   BASE_URL=https://127.0.0.1:19443 INSECURE=1 GATEWAY_METRICS_TOKEN=e2e-... ./scripts/ops/smoke.sh
#
# 可选：HTTP_URL=http://sso.example.com 验证 HTTP→HTTPS 跳转；
#       CERT_HOST/CERT_PORT 覆盖证书探测目标（默认从 BASE_URL 推导）。
#
set -euo pipefail

BASE_URL="${BASE_URL:-https://127.0.0.1:19443}"
HTTP_URL="${HTTP_URL:-}"
INSECURE="${INSECURE:-0}"
METRICS_TOKEN="${GATEWAY_METRICS_TOKEN:-${GATEWAY_SHARED_SECRET:-}}"
MIN_CERT_DAYS="${MIN_CERT_DAYS:-14}"
CURL=(curl -fsS --max-time 10)
[[ "$INSECURE" == "1" ]] && CURL+=(-k)

fail() { echo "✗ $*" >&2; exit 1; }
pass() { echo "✅ $*"; }

command -v curl >/dev/null 2>&1 || fail "未安装 curl"

echo "▶ 冒烟目标：$BASE_URL"
code="$(curl -sk --max-time 10 -o /dev/null -w '%{http_code}' "$BASE_URL/healthz" || true)"
[[ "$code" == "200" ]] || fail "GET /healthz = ${code:-network error}（期望 200）"
pass "Gateway 存活 /healthz"

code="$(curl -sk --max-time 10 -o /dev/null -w '%{http_code}' "$BASE_URL/login" || true)"
[[ "$code" == "200" ]] || fail "GET /login = ${code:-network error}（期望 200）"
pass "登录页 /login"

headers="$("${CURL[@]}" -D - -o /dev/null "$BASE_URL/login")" || fail "无法读取登录页响应头"
for h in strict-transport-security x-content-type-options x-frame-options; do
  printf '%s' "$headers" | grep -qi "^${h}:" || fail "缺少安全头 ${h}"
done
pass "安全头 HSTS / nosniff / frame-options"

if [[ -n "$METRICS_TOKEN" ]]; then
  code="$(curl -sk --max-time 10 -o /dev/null -w '%{http_code}' \
    -H "X-Gateway-Metrics-Key: $METRICS_TOKEN" "$BASE_URL/__gateway/metrics" || true)"
  [[ "$code" == "200" ]] || fail "metrics = ${code:-network error}（期望 200；检查 GATEWAY_METRICS_TOKEN）"
  pass "Gateway Prometheus metrics"
else
  echo "… 未提供 GATEWAY_METRICS_TOKEN，跳过 metrics"
fi

if [[ -n "$HTTP_URL" ]]; then
  code="$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$HTTP_URL" || true)"
  [[ "$code" == "301" || "$code" == "302" || "$code" == "307" || "$code" == "308" ]] \
    || fail "HTTP→HTTPS = ${code:-network error}（期望 3xx）"
  pass "HTTP→HTTPS 跳转"
fi

if command -v openssl >/dev/null 2>&1; then
  hostport="${BASE_URL#https://}"; hostport="${hostport%%/*}"
  CERT_HOST="${CERT_HOST:-${hostport%%:*}}"
  CERT_PORT="${CERT_PORT:-${hostport##*:}}"
  [[ "$CERT_PORT" == "$CERT_HOST" ]] && CERT_PORT=443
  cert="$( { echo | openssl s_client -connect "${CERT_HOST}:${CERT_PORT}" -servername "$CERT_HOST" 2>/dev/null || true; } )"
  if printf '%s' "$cert" | openssl x509 -noout -checkend $((MIN_CERT_DAYS * 86400)) >/dev/null 2>&1; then
    pass "证书有效期 ≥ ${MIN_CERT_DAYS} 天"
  else
    fail "证书无效或剩余不足 ${MIN_CERT_DAYS} 天"
  fi
else
  echo "… 未安装 openssl，跳过证书检查"
fi

echo "✅ 商业冒烟通过：$BASE_URL"
