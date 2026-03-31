#!/bin/bash
# start-services.sh - 启动所有测试服务

echo "=== 启动测试服务 ==="

# 检查端口是否已被占用
check_port() {
  if lsof -i :$1 > /dev/null 2>&1; then
    echo "端口 $1 已被占用"
    return 1
  fi
  return 0
}

# 等待服务启动
wait_for_service() {
  local url=$1
  local max_wait=30
  local count=0

  echo "等待服务启动: $url"
  while [ $count -lt $max_wait ]; do
    if curl -s $url > /dev/null 2>&1; then
      echo "服务已启动: $url"
      return 0
    fi
    sleep 1
    count=$((count + 1))
  done

  echo "服务启动超时: $url"
  return 1
}

# 启动IdP (port 4001)
if check_port 4001; then
  echo "启动 IdP..."
  cd /Users/liushuo/code/干了科技/auth-sso/apps/idp
  npm run dev > /tmp/idp.log 2>&1 &
  echo "IdP PID: $!"
fi

# 启动Portal (port 4000)
if check_port 4000; then
  echo "启动 Portal..."
  cd /Users/liushuo/code/干了科技/auth-sso/apps/portal
  npm run dev > /tmp/portal.log 2>&1 &
  echo "Portal PID: $!"
fi

# 启动Demo App (port 4002)
if check_port 4002; then
  echo "启动 Demo App..."
  cd /Users/liushuo/code/干了科技/auth-sso/apps/demo-app
  npm run dev > /tmp/demo-app.log 2>&1 &
  echo "Demo App PID: $!"
fi

# 等待服务启动
sleep 5

wait_for_service http://localhost:4001/api/auth/ok
wait_for_service http://localhost:4000/api/me
wait_for_service http://localhost:4002

echo "=== 所有服务已启动 ==="