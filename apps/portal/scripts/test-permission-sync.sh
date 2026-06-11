#!/bin/bash
# 本地权限同步注册集成测试脚本

PORTAL_URL="http://localhost:4100"
CLIENT_ID="demo-app"
CLIENT_SECRET="demo-app-secret"

echo "=== 1. 测试未带 Basic Auth 请求 ==="
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${PORTAL_URL}/api/permissions/register" \
  -H "Content-Type: application/json" \
  -d '{"permissions": []}')

if [ "$STATUS_CODE" -eq 401 ]; then
  echo "[PASS] 未认证拦截成功 ($STATUS_CODE)"
else
  echo "[FAIL] 未认证拦截失败 ($STATUS_CODE)"
  exit 1
fi

echo "=== 2. 测试错误密码越权拦截 ==="
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${PORTAL_URL}/api/permissions/register" \
  -u "${CLIENT_ID}:wrong_secret" \
  -H "Content-Type: application/json" \
  -d '{"permissions": []}')

if [ "$STATUS_CODE" -eq 403 ]; then
  echo "[PASS] 越权密码错误拦截成功 ($STATUS_CODE)"
else
  echo "[FAIL] 越权密码错误拦截失败 ($STATUS_CODE)"
  exit 1
fi

echo "=== 3. 模拟首批权限同步注册 (正常上报) ==="
PAYLOAD='{
  "permissions": [
    {
      "code": "test:menu",
      "name": "测试菜单",
      "type": "MENU",
      "resource": "/test",
      "sort": 1,
      "children": [
        {
          "code": "test:create",
          "name": "测试创建",
          "type": "API",
          "resource": "/api/test",
          "action": "POST",
          "sort": 10
        }
      ]
    }
  ]
}'

RESPONSE=$(curl -s -u "${CLIENT_ID}:${CLIENT_SECRET}" -X POST "${PORTAL_URL}/api/permissions/register" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

echo "首批同步返回: $RESPONSE"
if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "[PASS] 首批注册同步成功"
else
  echo "[FAIL] 首批注册同步失败"
  exit 1
fi

echo "=== 4. 模拟变更同步 (修改属性 + 下线 test:create + 新增 test:delete) ==="
PAYLOAD_V2='{
  "permissions": [
    {
      "code": "test:menu",
      "name": "已改名的测试菜单",
      "type": "MENU",
      "resource": "/test",
      "sort": 2,
      "children": [
        {
          "code": "test:delete",
          "name": "测试删除",
          "type": "API",
          "resource": "/api/test",
          "action": "DELETE",
          "sort": 20
        }
      ]
    }
  ]
}'

RESPONSE_V2=$(curl -s -u "${CLIENT_ID}:${CLIENT_SECRET}" -X POST "${PORTAL_URL}/api/permissions/register" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_V2")

echo "变更同步返回: $RESPONSE_V2"
if echo "$RESPONSE_V2" | grep -q '"success":true'; then
  echo "[PASS] 变更同步流程成功"
else
  echo "[FAIL] 变更同步流程失败"
  exit 1
fi

echo "=== 所有测试项校验完毕 ==="
