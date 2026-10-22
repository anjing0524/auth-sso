#!/usr/bin/env bash

set -euo pipefail

readonly compose_file="docker-compose.acme-staging.yml"
readonly tls_address="127.0.0.1:443"

is_valid_public_dns_name() {
  local domain="$1"
  local label
  local normalized_domain
  local labels

  [[ -n "${domain}" && ${#domain} -le 253 && "${domain}" == *.* ]] || return 1
  normalized_domain="$(printf '%s' "${domain}" | tr '[:upper:]' '[:lower:]')"
  [[ ! "${normalized_domain}" =~ ^[0-9.]+$ ]] || return 1
  case "${normalized_domain}" in
    *.local | *.localhost | *.test | *.example | *.invalid) return 1 ;;
  esac

  IFS='.' read -r -a labels <<<"${normalized_domain}"
  for label in "${labels[@]}"; do
    [[ ${#label} -le 63 && "${label}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] \
      || return 1
  done
}

is_valid_contact_email() {
  local email="$1"
  local email_domain

  [[ "${email}" == *@* && ! "${email}" =~ [[:space:]] ]] || return 1
  [[ -n "${email%%@*}" ]] || return 1
  email_domain="${email#*@}"
  is_valid_public_dns_name "${email_domain}"
}

domain_status="missing"
email_status="missing"
public_ingress_status="missing"

if [[ -n "${LETSENCRYPT_STAGING_DOMAIN:-}" ]]; then
  domain_status="invalid"
  is_valid_public_dns_name "${LETSENCRYPT_STAGING_DOMAIN}" && domain_status="valid"
fi
if [[ -n "${LETSENCRYPT_STAGING_EMAIL:-}" ]]; then
  email_status="invalid"
  is_valid_contact_email "${LETSENCRYPT_STAGING_EMAIL}" && email_status="valid"
fi
case "${ACME_STAGING_PUBLIC_REACHABLE:-}" in
  true) public_ingress_status="operator_attested" ;;
  false) public_ingress_status="unavailable" ;;
  "") ;;
  *) public_ingress_status="invalid" ;;
esac

preflight_status=""
if [[ "${domain_status}" == "invalid"
  || "${email_status}" == "invalid"
  || "${public_ingress_status}" == "invalid"
  || "${public_ingress_status}" == "unavailable" ]]; then
  preflight_status="blocked_invalid_prerequisites"
elif [[ "${domain_status}" == "missing"
  || "${email_status}" == "missing"
  || "${public_ingress_status}" == "missing" ]]; then
  preflight_status="blocked_missing_prerequisites"
fi

if [[ -n "${preflight_status}" ]]; then
  readonly preflight_evidence_dir="${ACME_STAGING_EVIDENCE_DIR:-.context/compound-engineering/acme-staging/preflight}"
  mkdir -p "${preflight_evidence_dir}"
  {
    echo "status=${preflight_status}"
    echo "public_letsencrypt_staging=not_run"
    echo "letsencrypt_staging_domain=${domain_status}"
    echo "letsencrypt_staging_email=${email_status}"
    echo "public_ingress=${public_ingress_status}"
  } >"${preflight_evidence_dir}/summary.txt"
  echo "Let's Encrypt staging 验收未执行：必须提供有效公网域名、联系邮箱，并设置 ACME_STAGING_PUBLIC_REACHABLE=true 确认公网 80/443 已可达" >&2
  exit 2
fi

readonly evidence_dir="${ACME_STAGING_EVIDENCE_DIR:-.context/compound-engineering/acme-staging/latest}"
mkdir -p "${evidence_dir}"
echo "status=failed_or_incomplete" >"${evidence_dir}/summary.txt"

readonly acme_domain="${LETSENCRYPT_STAGING_DOMAIN}"

compose() {
  docker compose -f "${compose_file}" "$@"
}

fail() {
  echo "Let's Encrypt staging 验收失败: $*" >&2
  exit 1
}

cleanup() {
  compose logs --no-color gateway redis >"${evidence_dir}/services.log" 2>&1 || true
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

wait_for_http() {
  local attempt status
  for attempt in $(seq 1 120); do
    status="$(
      curl --noproxy "*" --silent --output /dev/null --write-out "%{http_code}" \
        --resolve "${acme_domain}:80:127.0.0.1" \
        "http://${acme_domain}/acme-staging-readiness" 2>/dev/null || true
    )"
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
  for attempt in $(seq 1 300); do
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

compose config --quiet
compose down --volumes --remove-orphans >/dev/null 2>&1 || true
compose up --detach --build gateway

wait_for_http || fail "公网 HTTP-01 入口未在本机 80 端口就绪"

readonly container_id="$(compose ps --quiet gateway)"
[[ -n "${container_id}" ]] || fail "无法获取 Gateway 容器 ID"

wait_for_certificate "${evidence_dir}/issued-leaf.pem" \
  || fail "Let's Encrypt staging 未在 300 秒内签发证书"

openssl x509 -in "${evidence_dir}/issued-leaf.pem" -noout \
  -checkhost "${acme_domain}" \
  >"${evidence_dir}/hostname-verification.txt" \
  || fail "staging 证书 SAN 与域名不匹配"

openssl x509 -in "${evidence_dir}/issued-leaf.pem" -noout \
  -subject -issuer -serial -dates -ext subjectAltName \
  >"${evidence_dir}/issued-certificate.txt"

readonly restart_count="$(
  docker inspect --format '{{.RestartCount}}' "${container_id}"
)"
[[ "${restart_count}" == "0" ]] || fail "首次签发期间 Gateway 发生了进程重启"

compose exec -T gateway sh -ec '
  test -s /var/lib/gateway/acme/account.json
  test -s /var/lib/gateway/acme/certificate.json
  test "$(stat -c "%a" /var/lib/gateway/acme)" = "700"
  test "$(stat -c "%a" /var/lib/gateway/acme/account.json)" = "600"
  test "$(stat -c "%a" /var/lib/gateway/acme/certificate.json)" = "600"
' || fail "staging ACME 状态缺失或权限错误"

compose logs --no-color gateway \
  | grep -q "ACME 证书已持久化并原子热加载" \
  || fail "Gateway 日志缺少 staging 证书热加载事件"

readonly issued_fingerprint="$(
  certificate_fingerprint "${evidence_dir}/issued-leaf.pem"
)"
compose restart gateway
wait_for_http || fail "Gateway 重启后 HTTP 未恢复"
wait_for_certificate "${evidence_dir}/restored-leaf.pem" \
  || fail "Gateway 重启后 staging 证书未恢复"

readonly restored_fingerprint="$(
  certificate_fingerprint "${evidence_dir}/restored-leaf.pem"
)"
[[ "${issued_fingerprint}" == "${restored_fingerprint}" ]] \
  || fail "Gateway 重启后未恢复同一张 staging 证书"

{
  echo "status=passed"
  echo "public_letsencrypt_staging=passed"
  echo "public_ingress=validated_by_letsencrypt"
  echo "http01_validation=passed"
  echo "hot_install_without_restart=passed"
  echo "restart_recovery=passed"
  echo "domain=${acme_domain}"
  echo "gateway_container_id=${container_id}"
  echo "issued_fingerprint=${issued_fingerprint}"
  echo "restored_fingerprint=${restored_fingerprint}"
} >"${evidence_dir}/summary.txt"

echo "Let's Encrypt staging 验收通过，证据目录：${evidence_dir}"
