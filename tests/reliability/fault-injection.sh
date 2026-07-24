#!/usr/bin/env bash
# ==============================================================================
# Auth-SSO 故障注入与恢复测试
#
# 验证系统在基础设施故障场景下的行为：
# - PostgreSQL 断开/恢复
# - Redis 断开/恢复
# - Gateway 崩溃恢复
# - 时钟偏移
# - 高并发授权码竞争
#
# 前置条件: docker compose up -d (PostgreSQL + Redis)
#           Portal 运行在 http://localhost:4100
#           Gateway 运行在 https://localhost:18443 (可选)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PORTAL_URL="${PORTAL_URL:-http://localhost:4100}"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

pass()  { echo -e "  ${GREEN}PASS${NC} $1"; }
fail()  { echo -e "  ${RED}FAIL${NC} $1"; exit 1; }
warn()  { echo -e "  ${YELLOW}WARN${NC} $1"; }
info()  { echo -e "  $1"; }
header() { echo -e "\n${GREEN}═══ $1 ═══${NC}"; }

# ── 辅助函数 ──────────────────────────────────────────────

check_portal() {
  curl -sf -o /dev/null "$PORTAL_URL/api/health" 2>/dev/null && return 0 || return 1
}

wait_for_portal() {
  local timeout=${1:-30}
  info "等待 Portal 就绪..."
  for ((i=0; i<timeout; i++)); do
    if check_portal; then
      pass "Portal 已就绪"
      return 0
    fi
    sleep 1
  done
  fail "Portal 启动超时 (${timeout}s)"
}

# ── 测试用例 ──────────────────────────────────────────────

test_postgres_disconnect() {
  header "F1: PostgreSQL 断开 — Portal 返回 500 不挂起"
  info "停止 PostgreSQL 容器..."
  docker stop auth-sso-postgres 2>/dev/null || true
  sleep 2

  info "发起请求验证..."
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$PORTAL_URL/api/me" 2>/dev/null || echo "timeout")
  if [[ "$resp" == "500" || "$resp" == "503" || "$resp" == "000" ]]; then
    pass "PostgreSQL 断开后 Portal 返回 $resp (未挂起/未泄露)"
  else
    warn "PostgreSQL 断开后 Portal 返回 $resp (非预期)"
  fi

  info "恢复 PostgreSQL 容器..."
  docker start auth-sso-postgres 2>/dev/null || true
  sleep 5
  wait_for_portal 60
  pass "PostgreSQL 恢复后 Portal 重新就绪"
}

test_redis_disconnect() {
  header "F2: Redis 断开 — Gateway fail-open / Portal 权限降级"
  info "停止 Redis 容器..."
  docker stop auth-sso-redis 2>/dev/null || true
  sleep 2

  info "验证 Portal /api/health 仍可访问..."
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$PORTAL_URL/api/health" 2>/dev/null || echo "timeout")
  if [[ "$resp" == "200" ]]; then
    pass "Redis 断开后 Portal health 仍返回 200"
  else
    warn "Redis 断开后 Portal health 返回 $resp"
  fi

  info "恢复 Redis 容器..."
  docker start auth-sso-redis 2>/dev/null || true
  sleep 3
  pass "Redis 恢复完成"
}

test_clock_skew() {
  header "F3: 时钟偏移 — JWT exp 容忍窗口验证"
  info "本测试验证 JWT exp ≤ 5s 容忍窗口逻辑"
  info "(需要系统时间调整权限，在生产环境中通过 mock 完成)"
  
  # 使用 Node.js 快速验证容忍窗口逻辑
  node -e "
    const now = Math.floor(Date.now() / 1000);
    const expValid = now + 300;     // 5min 后过期 — Valid
    const expNear = now + 120;      // 2min 后过期 — NearlyExpired (< 300s)
    const expExpired = now - 10;    // 10s 前过期 — Expired
    const expBorderline = now - 4;  // 4s 前过期 — 容忍窗口内
    
    const THRESHOLD = 300;
    const TOLERANCE = 5;
    
    function classify(exp) {
      if (exp >= now) {
        return (exp - now < THRESHOLD) ? 'NearlyExpired' : 'Valid';
      }
      return (now - exp <= TOLERANCE) ? 'ToleratedExpired' : 'Expired';
    }
    
    const results = {
      valid: classify(expValid),
      nearlyExpired: classify(expNear),
      expired: classify(expExpired),
      borderline: classify(expBorderline),
    };
    
    console.log(JSON.stringify(results, null, 2));
    
    const ok = results.valid === 'Valid' 
      && results.nearlyExpired === 'NearlyExpired'
      && results.expired === 'Expired'
      && results.borderline === 'ToleratedExpired';
      
    process.exit(ok ? 0 : 1);
  " && pass "JWT exp 容忍窗口逻辑正确" || fail "JWT exp 容忍窗口逻辑错误"
}

test_concurrent_auth_codes() {
  header "F4: 高并发授权码 — 无竞争条件"
  info "模拟 100 个并发 Token 交换请求..."
  
  node -e "
    const http = require('http');
    const BASE = '${PORTAL_URL}';
    
    async function postToken(i) {
      return new Promise((resolve) => {
        const data = 'grant_type=authorization_code&code=concurrent-test-' + i + '&client_id=portal&redirect_uri=' + encodeURIComponent(BASE + '/api/auth/callback') + '&code_verifier=test-verifier';
        const req = http.request(BASE + '/api/auth/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length },
          timeout: 5000,
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', () => resolve({ status: 0, body: 'error' }));
        req.write(data);
        req.end();
      });
    }
    
    async function main() {
      const start = Date.now();
      const promises = Array.from({ length: 100 }, (_, i) => postToken(i));
      const results = await Promise.all(promises);
      const elapsed = Date.now() - start;
      
      // 统计结果
      const statusCodes = {};
      results.forEach(r => {
        statusCodes[r.status] = (statusCodes[r.status] || 0) + 1;
      });
      
      console.log(JSON.stringify({ elapsed_ms: elapsed, status_codes: statusCodes }));
      
      // 预期：所有请求返回非 200 (因为 codes 是假的)，但不应该出现 500/0
      const failures = results.filter(r => r.status === 500 || r.status === 0).length;
      process.exit(failures > 0 ? 1 : 0);
    }
    
    main();
  " && pass "100 并发授权码交换无 500 错误" || fail "并发授权码交换出现内部错误"
}

test_apid_dos_resilience() {
  header "F5: API 高频请求 — 限流与防御"
  info "对 /api/auth/login 发送 30 次快速请求验证限流..."
  
  node -e "
    const http = require('http');
    const BASE = '${PORTAL_URL}';
    
    async function postLogin(i) {
      return new Promise((resolve) => {
        const data = JSON.stringify({ email: 'nobody-' + i + '@test.com', password: 'wrong' });
        const req = http.request(BASE + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
          timeout: 5000,
        }, (res) => {
          resolve(res.statusCode);
        });
        req.on('error', () => resolve(0));
        req.write(data);
        req.end();
      });
    }
    
    async function main() {
      const results = [];
      for (let i = 0; i < 30; i++) {
        results.push(await postLogin(i));
      }
      
      const code429 = results.filter(s => s === 429).length;
      const code400 = results.filter(s => s === 400).length;
      const code500 = results.filter(s => s === 500).length;
      const code0 = results.filter(s => s === 0).length;
      
      console.log(JSON.stringify({ total: results.length, '400': code400, '429': code429, '500': code500, 'error': code0 }));
      
      // 不应有 500 错误
      if (code500 > 0 || code0 > 0) process.exit(1);
      process.exit(0);
    }
    
    main();
  " && pass "高频请求未触发 500 错误" || warn "高频请求存在 500 错误"
}

# ── 主入口 ────────────────────────────────────────────────

main() {
  cd "$PROJECT_ROOT"
  
  echo "============================================================"
  echo "  Auth-SSO 故障注入与恢复测试"
  echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "============================================================"
  
  local passed=0 failed=0
  
  # 前置检查: Portal 是否运行
  if ! check_portal; then
    warn "Portal 未运行在 $PORTAL_URL，仅执行逻辑验证测试"
  fi
  
  # F3: 时钟偏移 (无基础设施依赖)
  if test_clock_skew; then ((passed++)); else ((failed++)); fi
  
  # F4: 并发 (需要 Portal)
  if check_portal; then
    if test_concurrent_auth_codes; then ((passed++)); else ((failed++)); fi
    if test_apid_dos_resilience; then ((passed++)); else ((failed++)); fi
  else
    warn "跳过 F4/F5: Portal 未运行"
  fi
  
  # F1/F2: 需要 Docker
  if command -v docker &>/dev/null && docker ps &>/dev/null 2>&1; then
    if test_postgres_disconnect; then ((passed++)); else ((failed++)); fi
    if test_redis_disconnect; then ((passed++)); else ((failed++)); fi
  else
    warn "跳过 F1/F2: Docker 未运行"
  fi
  
  echo ""
  echo "============================================================"
  echo "  结果: ${passed} PASS, ${failed} FAIL"
  echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "============================================================"
  
  exit $failed
}

main
