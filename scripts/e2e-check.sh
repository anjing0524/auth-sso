#!/bin/bash
# 自动验证脚本 - Auto Verification Script

PORTAL_PORT=4100
IDP_PORT=4101

echo "--- 1. 启动 Auth-SSO 服务 (后台) ---"
pkill -f 'next dev' || true
cd apps/idp && pnpm dev --port $IDP_PORT > /tmp/idp.log 2>&1 &
cd apps/portal && pnpm dev --port $PORTAL_PORT > /tmp/portal.log 2>&1 &

echo "--- 2. 等待服务就绪 ---"
# 使用 curl 轮询
for i in {1..30}; do
  if curl -s http://localhost:$PORTAL_PORT > /dev/null && curl -s http://localhost:$IDP_PORT/api/auth/ok > /dev/null; then
    echo "✅ 服务已就绪!"
    READY=1
    break
  fi
  echo "⏳ 等待中 ($i/30)..."
  sleep 2
done

if [ "$READY" != "1" ]; then
  echo "❌ 服务启动超时"
  exit 1
fi

echo "--- 3. 执行 E2E 测试 ---"
node tests/runner.js e2e-complete-flow.test.js

echo "--- 4. 清理环境 ---"
pkill -f 'next dev'
