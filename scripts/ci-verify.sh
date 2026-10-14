#!/usr/bin/env bash
#
# 校验某个提交的 CI 是否**真的全绿**（retro A4）
#
# 为什么需要（本会话两次误读）：
#  1. 轮询"最新一次运行"却不核对 headSha ⇒ 读到的可能是**上一个提交**的结果；
#  2. GitHub 在**新推送**到来时会**取消**同一分支上仍在跑的旧运行 ⇒
#     "cancelled" 看起来像失败，其实是被取代（反之亦然：不能把 cancelled 当绿）。
#
# 用法：scripts/ci-verify.sh [sha]（默认 HEAD）；等待上限用 MAX_WAIT_SECONDS 覆盖。
set -uo pipefail

SHA="${1:-HEAD}"
FULL="$(git rev-parse "$SHA")"
SHORT="${FULL:0:7}"
MAX_WAIT="${MAX_WAIT_SECONDS:-3600}"
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

# 只认**这个 sha** 的运行，且取最新一次
RID="$(gh run list --limit 50 --json databaseId,headSha --jq "[.[] | select(.headSha == \"$FULL\")] | .[0].databaseId")"
if [ -z "$RID" ] || [ "$RID" = "null" ]; then
  echo "✗ 未找到 $SHORT 的 CI 运行（可能尚未触发）"
  exit 2
fi
echo "提交 $SHORT → run $RID"

waited=0
while :; do
  STATE="$(gh run view "$RID" --json status,conclusion --jq '"\(.status)|\(.conclusion // "-")"')"
  case "$STATE" in
    completed*) break ;;
  esac
  if [ "$waited" -ge "$MAX_WAIT" ]; then
    echo "✗ 等待超时（${MAX_WAIT}s）：$STATE"
    exit 3
  fi
  sleep 20
  waited=$((waited + 20))
done

echo "运行状态：$STATE"
echo "── 各 job ──"
gh run view "$RID" --json jobs --jq '.jobs[] | "\(.conclusion // .status)\t\(.name)"'

NON_SUCCESS_STEPS="$(gh api "repos/$REPO/actions/runs/$RID/jobs" \
  --jq '[.jobs[].steps[] | select(.conclusion != "success" and .conclusion != "skipped")] | length')"
CANCELLED_JOBS="$(gh run view "$RID" --json jobs --jq '[.jobs[] | select(.conclusion == "cancelled")] | length')"

if [ "$CANCELLED_JOBS" != "0" ]; then
  echo "✗ 有 $CANCELLED_JOBS 个 job 被取消：若同一分支已有更新的提交，说明这次运行**已被取代**——请对最新提交重跑本脚本"
  exit 1
fi
if [ "$NON_SUCCESS_STEPS" != "0" ]; then
  echo "✗ 非成功步骤数：$NON_SUCCESS_STEPS"
  exit 1
fi

echo "✓ 该提交的 CI 全绿（$NON_SUCCESS_STEPS 个非成功步骤）"
