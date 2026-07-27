#!/usr/bin/env bash

set -euo pipefail

cleanup() {
  docker compose -f docker-compose.test.yml down --volumes --remove-orphans
}

trap cleanup EXIT

docker compose -f docker-compose.test.yml up --detach --build --wait --wait-timeout 600 \
  postgres redis cert-init db-init portal gateway

export E2E_TARGET=docker
export E2E_BASE_URL="${E2E_BASE_URL:-https://127.0.0.1:19443}"
export E2E_SKIP_SEED=true

./node_modules/.bin/playwright test tests/e2e/docker-release.spec.ts "$@"
