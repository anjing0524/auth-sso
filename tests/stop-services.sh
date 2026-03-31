#!/bin/bash
# stop-services.sh - 停止所有测试服务

echo "=== 停止测试服务 ==="

# 停止端口4000的服务
if lsof -i :4000 > /dev/null 2>&1; then
  echo "停止 Portal (port 4000)..."
  lsof -ti :4000 | xargs kill -9 2>/dev/null || true
fi

# 停止端口4001的服务
if lsof -i :4001 > /dev/null 2>&1; then
  echo "停止 IdP (port 4001)..."
  lsof -ti :4001 | xargs kill -9 2>/dev/null || true
fi

# 停止端口4002的服务
if lsof -i :4002 > /dev/null 2>&1; then
  echo "停止 Demo App (port 4002)..."
  lsof -ti :4002 | xargs kill -9 2>/dev/null || true
fi

echo "=== 所有服务已停止 ==="