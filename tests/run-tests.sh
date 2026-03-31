#!/bin/bash
# run-tests.sh - 完整测试运行脚本
# 启动服务、运行测试、停止服务

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "=== Auth-SSO 自动化测试 ==="
echo "时间: $(date)"
echo ""

# 检查Redis是否运行
echo "检查 Redis..."
if ! redis-cli ping > /dev/null 2>&1; then
  echo "⚠️  Redis 未运行，请先启动 Redis"
  echo "  brew services start redis"
  echo "  或 redis-server"
  exit 1
fi
echo "✓ Redis 已运行"

# 检查PostgreSQL是否运行
echo "检查 PostgreSQL..."
if ! pg_isready > /dev/null 2>&1; then
  echo "⚠️  PostgreSQL 未运行，请先启动 PostgreSQL"
  echo "  brew services start postgresql"
  echo "  或 pg_ctl start"
  exit 1
fi
echo "✓ PostgreSQL 已运行"

# 启动服务
echo ""
echo "启动服务..."
bash "$SCRIPT_DIR/start-services.sh"

# 等待服务稳定
sleep 3

# 运行测试
echo ""
echo "运行测试..."
cd "$SCRIPT_DIR"
node runner.js

# 捕获测试结果
TEST_RESULT=$?

# 停止服务（可选，保留服务运行可以加快下次测试）
# echo ""
# echo "停止服务..."
# bash "$SCRIPT_DIR/stop-services.sh"

# 返回测试结果
exit $TEST_RESULT