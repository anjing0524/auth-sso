#!/usr/bin/env bash
#
# 推送 main 且**不把失败当成功**（retro A4）
#
# 为什么需要：此前每轮都在命令行里现写 `for i in $(seq 1 40); do … done`，
# 且在管道/子 shell 里把退出码丢了——脚本尾部的 `git status` 覆盖了 `$?`，
# 于是"推送失败"也可能以 0 退出（本会话出现过超时转后台、需要人工再看一次）。
#
# 语义（2026-10-15 按代码评审更正）：网络类失败**重试**；永久性拒绝（非快进、被保护分支）
# **立即以非零退出**，不做无谓等待。失败一律非零退出（不假装成功）。
#
# 用法：scripts/ci/push-main.sh [branch]（默认 main；重试上限用 MAX_ATTEMPTS 覆盖）
#
# 传输：按 AGENTS.md 的约定走 gh 凭据 + HTTPS（本机 SSH deploy key 对 auth-sso 无推送权限）。
set -uo pipefail

case "${1:-}" in
  -h|--help|help)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  -*)
    echo "未知参数：$1（--help 查看用法）" >&2
    exit 2
    ;;
esac

command -v gh >/dev/null 2>&1 || { echo "✗ 需要 gh CLI（HTTPS 推送凭据）" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BRANCH="${1:-main}"
MAX="${MAX_ATTEMPTS:-40}"
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)" || {
  echo "✗ 无法解析仓库（gh repo view 失败）" >&2; exit 1;
}
PUSH_URL="https://github.com/${REPO}.git"

for i in $(seq 1 "$MAX"); do
  if out=$(git -c credential.helper='!gh auth git-credential' push "$PUSH_URL" "$BRANCH" 2>&1); then
    echo "✓ push 成功（第 $i 次尝试）"
    echo "$out" | tail -2
    exit 0
  fi
  # 永久性拒绝：匹配 GitHub 的真实文案（大小写不敏感；GH006 = 保护分支）
  if printf '%s' "$out" | grep -qiE 'non-fast-forward|Updates were rejected|Protected branch|GH006|pre-receive hook declined'; then
    echo "✗ 永久性拒绝（重试无用）：$(echo "$out" | tail -1)"
    exit 1
  fi
  echo "… 第 $i/$MAX 次失败（网络类，重试）：$(echo "$out" | tail -1)"
  sleep 5
done

echo "✗ $MAX 次尝试后仍未推送成功"
exit 1
