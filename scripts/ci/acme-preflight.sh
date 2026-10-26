#!/usr/bin/env bash
#
# CI 预检：证明 scripts/e2e/acme-staging.sh 的**前置条件判定与证据格式**可用。
#
# 只跑脚本的 preflight 分支（不进 Docker、不访问公网），秒级；高成本的 Pebble 全生命周期
# 由 .github/workflows/acme.yml 的 lifecycle 作业承担（仅 release tag / 夜间跑）。
#
# 三个输入各断言一次「退出码 2 + summary.txt 的判定行」：
#   1. 缺全部前置条件            → blocked_missing_prerequisites + public_letsencrypt_staging=not_run
#   2. 域名/邮箱无效 + 公网不可达 → blocked_invalid_prerequisites + domain=invalid + ingress=unavailable
#   3. IP 字面量当域名（公网可达）→ letsencrypt_staging_domain=invalid
# 任何一条不符即非零退出——预检脚本是"证据生成器"，它自己也得有证据。
#
# 本脚本只被 .github/workflows/acme.yml 调用（本地无独立入口）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

readonly EVIDENCE_ROOT=".context/compound-engineering/acme-staging/preflight"
readonly STAGING_SCRIPT="./scripts/e2e/acme-staging.sh"

# 清掉调用者环境里的 AMP 变量：否则"缺少前置条件"场景会落进别的分支
run_preflight() {
  local evidence_dir="$1"
  shift
  local status=0
  env -u LETSENCRYPT_STAGING_DOMAIN -u LETSENCRYPT_STAGING_EMAIL -u ACME_STAGING_PUBLIC_REACHABLE \
    ACME_STAGING_EVIDENCE_DIR="$evidence_dir" "$@" "$STAGING_SCRIPT" || status=$?
  if [[ "$status" -ne 2 ]]; then
    echo "✗ 预检脚本退出码 $status（期望 2：blocked_*，不进 Docker）" >&2
    exit 1
  fi
}

assert_summary() {
  local summary="$1"
  shift
  local expected
  for expected in "$@"; do
    if ! grep -qx "$expected" "$summary"; then
      echo "✗ $summary 缺少行：$expected" >&2
      exit 1
    fi
  done
}

run_preflight "$EVIDENCE_ROOT/missing"
assert_summary "$EVIDENCE_ROOT/missing/summary.txt" \
  status=blocked_missing_prerequisites \
  public_letsencrypt_staging=not_run

run_preflight "$EVIDENCE_ROOT/invalid" \
  LETSENCRYPT_STAGING_DOMAIN=local \
  LETSENCRYPT_STAGING_EMAIL=ops@example.org \
  ACME_STAGING_PUBLIC_REACHABLE=false
assert_summary "$EVIDENCE_ROOT/invalid/summary.txt" \
  status=blocked_invalid_prerequisites \
  letsencrypt_staging_domain=invalid \
  public_ingress=unavailable

run_preflight "$EVIDENCE_ROOT/ip-literal" \
  LETSENCRYPT_STAGING_DOMAIN=127.0.0.1 \
  LETSENCRYPT_STAGING_EMAIL=ops@example.org \
  ACME_STAGING_PUBLIC_REACHABLE=true
assert_summary "$EVIDENCE_ROOT/ip-literal/summary.txt" \
  letsencrypt_staging_domain=invalid

echo "✓ ACME staging 预检契约成立（3 个场景的退出码与证据行全部符合）"
