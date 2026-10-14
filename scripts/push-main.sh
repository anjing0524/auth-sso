#!/usr/bin/env bash
#
# 推送 main 并**保留真实退出码**（retro A4）
#
# 为什么需要：此前每轮都在命令行里现写 `for i in $(seq 1 40); do … done`，
# 且在管道/子 shell 里把真实退出码丢了——脚本尾部的 `git status` 覆盖了 `$?`，
# 于是"推送失败"也可能以 0 退出（本会话出现过超时转后台、需要人工再看一次）。
#
# 用法：scripts/push-main.sh [branch]（默认 main；重试上限用 MAX_ATTEMPTS 覆盖）
set -uo pipefail

BRANCH="${1:-main}"
MAX="${MAX_ATTEMPTS:-40}"

for i in $(seq 1 "$MAX"); do
  if out=$(git push origin "$BRANCH" 2>&1); then
    echo "✓ push 成功（第 $i 次尝试）"
    echo "$out" | tail -2
    exit 0
  fi
  echo "… 第 $i/$MAX 次失败：$(echo "$out" | tail -1)"
  sleep 5
done

echo "✗ $MAX 次尝试后仍未推送成功"
exit 1
