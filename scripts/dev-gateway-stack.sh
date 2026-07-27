#!/usr/bin/env bash

set -euo pipefail

docker compose up -d postgres redis

cleanup() {
  local pids=("${portal_pid:-}" "${demo_pid:-}" "${gateway_pid:-}")
  for pid in "${pids[@]}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
  wait "${portal_pid:-}" "${demo_pid:-}" "${gateway_pid:-}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

pnpm --filter @auth-sso/portal dev &
portal_pid=$!

pnpm --filter @auth-sso/demo-app dev &
demo_pid=$!

cargo run --manifest-path apps/gateway/Cargo.toml -- -c apps/gateway/gateway.toml &
gateway_pid=$!

wait -n "${portal_pid}" "${demo_pid}" "${gateway_pid}"
