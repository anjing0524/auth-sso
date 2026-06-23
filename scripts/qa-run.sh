#!/usr/bin/env bash
# ==============================================================================
# 脚本名称: qa-run.sh
# 脚本功能: Auth-SSO QA 自动化执行入口 — 后台启动服务 + Chrome 调试 + E2E 验证
# 使用方法: ./scripts/qa-run.sh [选项]
#
# 选项:
#   --reset-db      重置并重新 seed 数据库
#   --headless      无界面模式（CI 环境使用）
#   --skip-gateway  跳过 Gateway 启动（仅测试 Portal 直连）
#   --stop          停止所有后台服务
#   --help          显示帮助信息
# ==============================================================================
set -euo pipefail

# ── 配置变量 ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORTAL_URL="http://127.0.0.1:4100"
GATEWAY_HTTPS="https://127.0.0.1:18443"
PORTAL_LOG="/tmp/auth-sso-portal.log"
GATEWAY_LOG="/tmp/auth-sso-gateway.log"
PORTAL_PID_FILE="/tmp/auth-sso-portal.pid"
GATEWAY_PID_FILE="/tmp/auth-sso-gateway.pid"

# ── 参数解析 ──────────────────────────────────────────────────────────────────
RESET_DB=false
HEADLESS=false
SKIP_GATEWAY=false
STOP_MODE=false

for arg in "$@"; do
    case $arg in
        --reset-db) RESET_DB=true ;;
        --headless) HEADLESS=true ;;
        --skip-gateway) SKIP_GATEWAY=true ;;
        --stop) STOP_MODE=true ;;
        --help)
            echo "用法: $0 [--reset-db] [--headless] [--skip-gateway] [--stop]"
            exit 0
            ;;
    esac
done

# ── 颜色输出工具函数 ──────────────────────────────────────────────────────────
log_info()    { echo -e "\033[32m[INFO]\033[0m $*"; }
log_warn()    { echo -e "\033[33m[WARN]\033[0m $*"; }
log_error()   { echo -e "\033[31m[ERROR]\033[0m $*"; }
log_section() { echo -e "\n\033[1;36m═══ $* ═══\033[0m"; }

# ── 停止模式 ──────────────────────────────────────────────────────────────────
stop_services() {
    log_section "停止所有 Auth-SSO 服务"
    if [ -f "$PORTAL_PID_FILE" ]; then
        local pid
        pid=$(cat "$PORTAL_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" && log_info "Portal (PID: $pid) 已停止"
        fi
        rm -f "$PORTAL_PID_FILE"
    fi
    if [ -f "$GATEWAY_PID_FILE" ]; then
        local pid
        pid=$(cat "$GATEWAY_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" && log_info "Gateway (PID: $pid) 已停止"
        fi
        rm -f "$GATEWAY_PID_FILE"
    fi
    log_info "✅ 服务已全部停止"
}

if $STOP_MODE; then
    stop_services
    exit 0
fi

# ── 执行开始 ──────────────────────────────────────────────────────────────────
cd "$PROJECT_ROOT"
log_section "Auth-SSO QA 执行开始"
log_info "时间: $(date '+%Y-%m-%d %H:%M:%S')"
log_info "项目根目录: $PROJECT_ROOT"

# ── 步骤 1: 前置条件检查 ──────────────────────────────────────────────────────
log_section "步骤 1: 前置条件检查"

# 检查 PostgreSQL
if pg_isready -h 127.0.0.1 -p 5432 > /dev/null 2>&1; then
    log_info "✅ PostgreSQL 运行正常"
else
    log_warn "⚠️  PostgreSQL 未就绪，尝试通过 Docker Compose 启动..."
    docker compose up -d postgres 2>/dev/null || true
    sleep 3
fi

# 检查 Redis
if redis-cli ping > /dev/null 2>&1; then
    log_info "✅ Redis 运行正常"
else
    log_warn "⚠️  Redis 未就绪，尝试通过 Docker Compose 启动..."
    docker compose up -d redis 2>/dev/null || true
    sleep 2
fi

# 检查 Gateway SSL 证书
if [ -f "apps/gateway/ssl/fullchain.pem" ] && [ -f "apps/gateway/ssl/privkey.pem" ]; then
    log_info "✅ SSL 证书存在"
else
    log_warn "❌ Gateway SSL 证书不存在于 apps/gateway/ssl/"
    log_warn "生成自签名证书命令:"
    log_warn "  mkdir -p apps/gateway/ssl && cd apps/gateway/ssl"
    log_warn "  openssl req -x509 -newkey rsa:4096 -keyout privkey.pem -out fullchain.pem -days 365 -nodes -subj '/CN=localhost'"
fi

# ── 步骤 2: 数据库初始化 ──────────────────────────────────────────────────────
log_section "步骤 2: 数据库初始化"

if $RESET_DB; then
    log_info "♻️  执行数据库 push + seed..."
    pnpm db:push && log_info "✅ Schema push 完成"
    pnpm db:seed && log_info "✅ 种子数据写入完成"
else
    log_info "跳过数据库重置（使用 --reset-db 参数强制重置）"
fi

# ── 步骤 3: 后台启动 Portal ───────────────────────────────────────────────────
log_section "步骤 3: 后台启动 Portal (Next.js :4100)"

if curl -sf "$PORTAL_URL" > /dev/null 2>&1; then
    log_info "✅ Portal 已在运行 ($PORTAL_URL)"
else
    log_info "📦 启动 Portal..."
    nohup pnpm --filter @auth-sso/portal dev > "$PORTAL_LOG" 2>&1 &
    echo $! > "$PORTAL_PID_FILE"
    log_info "Portal 进程 PID: $(cat "$PORTAL_PID_FILE")，日志: $PORTAL_LOG"

    # 等待 Portal 就绪（最多 90 秒）
    WAIT_SECONDS=0
    MAX_WAIT=90
    while ! curl -sf "$PORTAL_URL" > /dev/null 2>&1; do
        if [ $WAIT_SECONDS -ge $MAX_WAIT ]; then
            log_error "❌ Portal 启动超时 (${MAX_WAIT}s)，请查看日志: tail -f $PORTAL_LOG"
            exit 1
        fi
        sleep 3
        WAIT_SECONDS=$((WAIT_SECONDS + 3))
        echo -ne "  ⏳ 等待 Portal... ${WAIT_SECONDS}s\r"
    done
    echo ""
    log_info "✅ Portal 已就绪 ($PORTAL_URL)"
fi

# ── 步骤 4: 后台启动 Gateway ──────────────────────────────────────────────────
log_section "步骤 4: 后台启动 Gateway (Rust/Pingora :18443)"

if $SKIP_GATEWAY; then
    log_warn "⚠️  跳过 Gateway 启动（--skip-gateway）"
else
    if curl -sk "$GATEWAY_HTTPS" > /dev/null 2>&1; then
        log_info "✅ Gateway 已在运行 ($GATEWAY_HTTPS)"
    else
        log_info "🔒 启动 Gateway..."
        cd apps/gateway

        # 如果 release binary 不存在，先编译
        if [ ! -f "target/release/gateway" ]; then
            log_info "🔨 编译 Gateway (首次需要较长时间)..."
            cargo build --release 2>&1 | tail -5
        fi

        nohup ./target/release/gateway --config gateway.toml > "$GATEWAY_LOG" 2>&1 &
        echo $! > "$GATEWAY_PID_FILE"
        log_info "Gateway 进程 PID: $(cat "$GATEWAY_PID_FILE")，日志: $GATEWAY_LOG"
        cd "$PROJECT_ROOT"

        # 等待 Gateway 就绪（最多 15 秒）
        sleep 3
        if curl -sk "$GATEWAY_HTTPS" > /dev/null 2>&1; then
            log_info "✅ Gateway 已就绪 ($GATEWAY_HTTPS)"
        else
            log_warn "⚠️  Gateway 可能未完全就绪，请检查日志: tail -f $GATEWAY_LOG"
        fi
    fi
fi

# ── 步骤 5: 打开 Chrome DevTools ─────────────────────────────────────────────
log_section "步骤 5: Chrome DevTools 调试模式"

if ! $HEADLESS; then
    CHROME_BINARY="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if [ -f "$CHROME_BINARY" ]; then
        log_info "🌐 启动 Chrome (远程调试端口: 9222)..."
        "$CHROME_BINARY" \
            --remote-debugging-port=9222 \
            --ignore-certificate-errors \
            --allow-insecure-localhost \
            --user-data-dir=/tmp/chrome-auth-sso-qa \
            --no-first-run \
            --disable-extensions \
            "${GATEWAY_HTTPS}/login" > /dev/null 2>&1 &
        sleep 2
        log_info "✅ Chrome 已打开 Gateway 登录页"
        log_info "   调试端点: http://localhost:9222"
        log_info "   DevTools 快捷键: F12 或 Cmd+Option+I"
        log_info ""
        log_info "   📋 DevTools 配置建议:"
        log_info "   Network  → ✅ Preserve log | ✅ Disable cache"
        log_info "   Console  → ✅ Preserve log | 过滤: Verbose"
        log_info "   Application → Cookies → 监控 portal_jwt_token"
    else
        log_warn "⚠️  未找到 Chrome，请手动打开: $GATEWAY_HTTPS/login"
    fi
else
    log_info "无界面模式，跳过 Chrome 启动"
fi

# ── 步骤 6: 执行 Playwright E2E 测试 ─────────────────────────────────────────
log_section "步骤 6: Playwright E2E 测试执行"

log_info "🧪 开始运行 E2E 测试（覆盖所有需求矩阵模块）..."
if $HEADLESS; then
    pnpm test:e2e --reporter=list 2>&1 | tee /tmp/auth-sso-e2e.log
    E2E_EXIT_CODE=${PIPESTATUS[0]}
else
    pnpm test:e2e --reporter=list 2>&1 | tee /tmp/auth-sso-e2e.log
    E2E_EXIT_CODE=${PIPESTATUS[0]}
fi

# ── 步骤 7: 生成覆盖率报告 ───────────────────────────────────────────────────
log_section "步骤 7: 需求追踪覆盖率报告"

pnpm test:report 2>&1 | tail -10 || true
log_info "覆盖率报告: $PROJECT_ROOT/tests/traceability/coverage-report.md"

# ── 总结输出 ──────────────────────────────────────────────────────────────────
log_section "执行结果汇总"
log_info "完成时间: $(date '+%Y-%m-%d %H:%M:%S')"
log_info ""
log_info "📋 日志文件:"
log_info "   Portal:  $PORTAL_LOG"
log_info "   Gateway: $GATEWAY_LOG"
log_info "   E2E:     /tmp/auth-sso-e2e.log"
log_info ""
log_info "📊 报告文件:"
log_info "   E2E 报告:    $PROJECT_ROOT/tests/e2e-report/index.html"
log_info "   覆盖率报告:  $PROJECT_ROOT/tests/traceability/coverage-report.md"
log_info ""
log_info "🔧 排查问题:"
log_info "   tail -f $PORTAL_LOG"
log_info "   tail -f $GATEWAY_LOG"
log_info ""
log_info "🛑 停止服务: ./scripts/qa-run.sh --stop"

if [ "${E2E_EXIT_CODE:-0}" -eq 0 ]; then
    log_info ""
    log_info "✅ ✅ ✅ 所有 E2E 测试通过！需求矩阵验证完成 ✅ ✅ ✅"
else
    log_error ""
    log_error "❌ 部分 E2E 测试失败，请查看报告: open tests/e2e-report/index.html"
    exit "${E2E_EXIT_CODE:-1}"
fi
