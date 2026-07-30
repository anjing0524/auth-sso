#!/usr/bin/env bash

set -euo pipefail

readonly compose_file="docker-compose.test.yml"
readonly acme_domain="gateway.test"
readonly http_url="http://127.0.0.1:19080/acme-readiness"
readonly tls_address="127.0.0.1:19444"
readonly pebble_ca="tests/acme/pebble.minica.pem"
readonly evidence_dir="${ACME_EVIDENCE_DIR:-.context/compound-engineering/acme-e2e/latest}"

mkdir -p "${evidence_dir}"
echo "status=failed_or_incomplete" >"${evidence_dir}/summary.txt"

compose() {
  docker compose -f "${compose_file}" "$@"
}

fail() {
  echo "ACME E2E 失败: $*" >&2
  exit 1
}

cleanup() {
  compose unpause pebble >/dev/null 2>&1 || true
  compose logs --no-color pebble challtestsrv gateway-acme >"${evidence_dir}/services.log" 2>&1 || true
  compose --profile acme down --volumes --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

wait_for_pebble() {
  local attempt
  for attempt in $(seq 1 60); do
    if curl --noproxy "*" --silent --show-error --fail \
      --cacert "${pebble_ca}" https://localhost:14000/dir \
      >"${evidence_dir}/pebble-directory.json" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_http() {
  local attempt status
  for attempt in $(seq 1 60); do
    status="$(curl --noproxy "*" --silent --output /dev/null \
      --write-out "%{http_code}" "${http_url}" 2>/dev/null || true)"
    if [[ "${status}" == "301" ]]; then
      echo "${status}" >"${evidence_dir}/http-status.txt"
      return 0
    fi
    sleep 1
  done
  return 1
}

capture_leaf_certificate() {
  local output_path="$1"
  openssl s_client -connect "${tls_address}" -servername "${acme_domain}" -showcerts \
    </dev/null 2>/dev/null \
    | openssl x509 -out "${output_path}" 2>/dev/null
}

wait_for_certificate() {
  local output_path="$1"
  local attempt
  for attempt in $(seq 1 90); do
    if capture_leaf_certificate "${output_path}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

certificate_fingerprint() {
  openssl x509 -in "$1" -noout -fingerprint -sha256
}

wait_for_lifecycle_failure() {
  local since="$1"
  local attempt
  for attempt in $(seq 1 90); do
    if compose logs --no-color --since "${since}" gateway-acme 2>/dev/null \
      | grep -q "ACME 证书生命周期任务失败"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

compose --profile acme down --volumes --remove-orphans >/dev/null 2>&1 || true
compose build pebble challtestsrv gateway-acme
compose up --detach redis pebble challtestsrv
wait_for_pebble || fail "Pebble directory 未就绪"

compose pause pebble
compose up --detach --no-deps gateway-acme
wait_for_http || fail "Gateway HTTP 引导监听器未返回 301"

readonly container_id_before="$(compose ps --quiet gateway-acme)"
[[ -n "${container_id_before}" ]] || fail "无法获取 Gateway 容器 ID"

if capture_leaf_certificate "${evidence_dir}/unexpected-pre-issuance.pem"; then
  fail "Pebble 暂停期间 HTTPS 不应已经呈现证书"
fi
echo "no-certificate" >"${evidence_dir}/pre-issuance-https.txt"

compose unpause pebble
wait_for_certificate "${evidence_dir}/issued-leaf.pem" || fail "恢复 Pebble 后未签发证书"

readonly container_id_after_issuance="$(compose ps --quiet gateway-acme)"
[[ "${container_id_before}" == "${container_id_after_issuance}" ]] \
  || fail "签发过程中 Gateway 容器发生了替换"

readonly restart_count_after_issuance="$(
  docker inspect --format '{{.RestartCount}}' "${container_id_after_issuance}"
)"
[[ "${restart_count_after_issuance}" == "0" ]] \
  || fail "签发过程中 Gateway 发生了进程重启"

curl --noproxy "*" --silent --show-error --fail \
  --cacert "${pebble_ca}" https://localhost:15000/roots/0 \
  --output "${evidence_dir}/pebble-issuer-root.pem"

openssl s_client -connect "${tls_address}" -servername "${acme_domain}" \
  -verify_hostname "${acme_domain}" \
  -CAfile "${evidence_dir}/pebble-issuer-root.pem" \
  -verify_return_error </dev/null \
  >"${evidence_dir}/tls-verification.log" 2>&1 \
  || fail "签发后 TLS 链或域名验证失败"

openssl x509 -in "${evidence_dir}/issued-leaf.pem" -noout \
  -subject -issuer -dates -ext subjectAltName \
  >"${evidence_dir}/issued-certificate.txt"

compose exec -T gateway-acme sh -ec '
  test -s /var/lib/gateway/acme/account.json
  test -s /var/lib/gateway/acme/certificate.json
  test "$(stat -c "%a" /var/lib/gateway/acme)" = "700"
  test "$(stat -c "%a" /var/lib/gateway/acme/account.json)" = "600"
  test "$(stat -c "%a" /var/lib/gateway/acme/certificate.json)" = "600"
  stat -c "%a %n" \
    /var/lib/gateway/acme \
    /var/lib/gateway/acme/account.json \
    /var/lib/gateway/acme/certificate.json
' >"${evidence_dir}/state-permissions.txt"

readonly issued_fingerprint="$(certificate_fingerprint "${evidence_dir}/issued-leaf.pem")"
readonly started_before_restart="$(
  docker inspect --format '{{.State.StartedAt}}' "${container_id_after_issuance}"
)"

compose restart gateway-acme
wait_for_http || fail "Gateway 重启后 HTTP 未恢复"
wait_for_certificate "${evidence_dir}/restored-leaf.pem" || fail "Gateway 重启后证书未恢复"

readonly restored_fingerprint="$(certificate_fingerprint "${evidence_dir}/restored-leaf.pem")"
[[ "${issued_fingerprint}" == "${restored_fingerprint}" ]] \
  || fail "Gateway 重启后未恢复同一张持久化证书"

readonly started_after_restart="$(
  docker inspect --format '{{.State.StartedAt}}' "${container_id_after_issuance}"
)"
[[ "${started_before_restart}" != "${started_after_restart}" ]] \
  || fail "重启恢复场景没有实际重启 Gateway 进程"

readonly failure_started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
compose stop pebble
wait_for_lifecycle_failure "${failure_started_at}" \
  || fail "Pebble 故障后未观察到 ACME 生命周期失败与重试"

wait_for_certificate "${evidence_dir}/failure-retained-leaf.pem" \
  || fail "Pebble 故障后 Gateway 未继续呈现旧证书"
readonly retained_fingerprint="$(
  certificate_fingerprint "${evidence_dir}/failure-retained-leaf.pem"
)"
[[ "${restored_fingerprint}" == "${retained_fingerprint}" ]] \
  || fail "Pebble 故障后 Gateway 未保留上一有效 TLS 快照"

readonly started_after_failure="$(
  docker inspect --format '{{.State.StartedAt}}' "${container_id_after_issuance}"
)"
[[ "${started_after_restart}" == "${started_after_failure}" ]] \
  || fail "ACME 故障导致 Gateway 进程重启"

cat >"${evidence_dir}/summary.txt" <<EOF
status=passed
first_issuance=passed
http01_validation=passed
https_before_issuance=no_certificate
hot_install_without_restart=passed
restart_recovery=passed
ca_failure_retains_certificate=passed
gateway_container_id=${container_id_after_issuance}
issued_fingerprint=${issued_fingerprint}
restored_fingerprint=${restored_fingerprint}
retained_fingerprint=${retained_fingerprint}
EOF

echo "Gateway ACME E2E 验收通过，证据目录：${evidence_dir}"
