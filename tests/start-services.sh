#!/bin/bash
# start-services.sh - 启动本地开发环境

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查端口是否被占用
check_port() {
  local port=$1
  if lsof -i :"$port" > /dev/null 2>&1; then
    echo -e "${RED}❌ 端口 $port 已被占用${NC}"
    lsof -i :"$port" | grep LISTEN
    return 1
  fi
  return 0
}

# 等待服务启动
wait_for_service() {
  local url=$1
  local name=$2
  local max_wait=60
  local count=0

  echo -e "${YELLOW}⏳ 等待 $name 启动: $url${NC}"
  while [ $count -lt $max_wait ]; do
    if curl -s "$url" > /dev/null 2>&1; then
      echo -e "${GREEN}✅ $name 已启动${NC}"
      return 0
    fi
    sleep 1
    count=$((count + 1))
    echo -n "."
  done

  echo -e "${RED}\n❌ $name 启动超时${NC}"
  return 1
}

# 检查环境变量文件
check_env_files() {
  local missing=0

  if [ ! -f "$PROJECT_ROOT/apps/idp/.env.local" ]; then
    echo -e "${YELLOW}⚠️  缺少 apps/idp/.env.local${NC}"
    echo "   请复制 apps/idp/.env.example 并配置"
    missing=1
  fi

  if [ ! -f "$PROJECT_ROOT/apps/portal/.env.local" ]; then
    echo -e "${YELLOW}⚠️  缺少 apps/portal/.env.local${NC}"
    echo "   请复制 apps/portal/.env.example 并配置"
    missing=1
  fi

  if [ $missing -eq 1 ]; then
    echo ""
    echo -e "${RED}请配置环境变量后重试${NC}"
    exit 1
  fi
}

# 检查依赖是否安装
check_dependencies() {
  if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    echo -e "${YELLOW}📦 安装依赖...${NC}"
    cd "$PROJECT_ROOT"
    pnpm install
  fi
}

# 停止已存在的服务
stop_existing_services() {
  echo -e "${YELLOW}🛑 检查并停止已存在的服务...${NC}"
  pkill -f "next dev -p 4001" 2>/dev/null || true
  pkill -f "next dev -p 4000" 2>/dev/null || true
  pkill -f "next dev -p 4002" 2>/dev/null || true
  sleep 2
}

# 主流程
echo -e "${GREEN}=== Auth-SSO 本地开发环境启动 ===${NC}\n"

# 1. 检查环境变量
echo -e "${YELLOW}🔍 检查环境变量...${NC}"
check_env_files

# 2. 检查依赖
check_dependencies

# 3. 停止已存在的服务
stop_existing_services

# 4. 检查端口
echo -e "${YELLOW}🔍 检查端口...${NC}"
check_port 4000 || exit 1
check_port 4001 || exit 1
check_port 4002 || exit 1
echo -e "${GREEN}✅ 端口检查通过${NC}\n"

# 5. 启动服务
echo -e "${YELLOW}🚀 启动服务...${NC}\n"

# 启动 IdP (先启动，因为 Portal 和 Demo 依赖它)
echo -e "${YELLOW}▶️  启动 IdP (http://localhost:4001)...${NC}"
cd "$PROJECT_ROOT/apps/idp"
LOG_LEVEL=debug pnpm dev > /tmp/idp.log 2>&1 &
IDP_PID=$!
echo "   PID: $IDP_PID"

# 等待 IdP 启动
sleep 3
wait_for_service "http://localhost:4001/api/auth/ok" "IdP" || {
  echo -e "${RED}IdP 启动失败，查看日志: /tmp/idp.log${NC}"
  tail -50 /tmp/idp.log
  exit 1
}

# 启动 Portal
echo -e "${YELLOW}▶️  启动 Portal (http://localhost:4000)...${NC}"
cd "$PROJECT_ROOT/apps/portal"
LOG_LEVEL=debug pnpm dev > /tmp/portal.log 2>&1 &
PORTAL_PID=$!
echo "   PID: $PORTAL_PID"

sleep 2
wait_for_service "http://localhost:4000" "Portal" || {
  echo -e "${RED}Portal 启动失败，查看日志: /tmp/portal.log${NC}"
  tail -50 /tmp/portal.log
  exit 1
}

# 启动 Demo App
echo -e "${YELLOW}▶️  启动 Demo App (http://localhost:4002)...${NC}"
cd "$PROJECT_ROOT/apps/demo-app"
pnpm dev > /tmp/demo-app.log 2>&1 &
DEMO_PID=$!
echo "   PID: $DEMO_PID"

sleep 2
wait_for_service "http://localhost:4002" "Demo App" || {
  echo -e "${RED}Demo App 启动失败，查看日志: /tmp/demo-app.log${NC}"
  tail -50 /tmp/demo-app.log
  exit 1
}

# 6. 输出成功信息
echo ""
echo -e "${GREEN}=======================================${NC}"
echo -e "${GREEN}✅ 所有服务已启动!${NC}"
echo -e "${GREEN}=======================================${NC}"
echo ""
echo -e "🌐 IdP:       http://localhost:4001"
echo -e "🌐 Portal:    http://localhost:4000"
echo -e "🌐 Demo App:  http://localhost:4002"
echo ""
echo -e "📋 日志文件:"
echo "   IdP:       /tmp/idp.log"
echo "   Portal:    /tmp/portal.log"
echo "   Demo App:  /tmp/demo-app.log"
echo ""
echo -e "🛑 停止服务: pkill -f 'next dev'"
echo ""

# 保持脚本运行
tail -f /dev/null
