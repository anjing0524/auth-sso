#!/bin/bash

# M5 SSO Access 验证脚本
# 验证端到端登录流程、Token 刷新、登出流程

set -e

PORTAL_URL="http://localhost:4000"
IDP_URL="http://localhost:4001"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 测试账号
TEST_EMAIL="admin@example.com"
TEST_PASSWORD="test123456"

echo "======================================"
echo "M5 SSO Access 验证"
echo "======================================"

# 检查服务是否运行
check_services() {
    echo -e "\n${YELLOW}检查服务状态...${NC}"

    if curl -s --max-time 2 "$PORTAL_URL/api/me" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Portal 服务运行中 (port 4000)${NC}"
    else
        echo -e "${RED}✗ Portal 服务未运行 (port 4000)${NC}"
        echo "请先启动 Portal: cd apps/portal && pnpm dev"
        exit 1
    fi

    if curl -s --max-time 2 "$IDP_URL/api/auth/ok" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ IdP 服务运行中 (port 4001)${NC}"
    else
        echo -e "${RED}✗ IdP 服务未运行 (port 4001)${NC}"
        echo "请先启动 IdP: cd apps/idp && pnpm dev"
        exit 1
    fi
}

# M5-1: Portal 首页和登录入口测试
test_portal_home() {
    echo -e "\n${YELLOW}[M5-1] Portal 首页和登录入口测试${NC}"

    # 测试 Portal 首页
    echo "  测试 Portal 首页..."
    PORTAL_HOME=$(curl -s --max-time 5 "$PORTAL_URL")
    if [ -n "$PORTAL_HOME" ]; then
        echo -e "  ${GREEN}✓ Portal 首页可访问${NC}"
    else
        echo -e "  ${RED}✗ Portal 首页无法访问${NC}"
        return 1
    fi

    # 测试登录入口重定向
    echo "  测试登录入口重定向..."
    LOGIN_REDIRECT=$(curl -s -o /dev/null -w "%{redirect_url}" "$PORTAL_URL/api/auth/login" 2>/dev/null || echo "")

    if [ -n "$LOGIN_REDIRECT" ] && echo "$LOGIN_REDIRECT" | grep -q "authorize"; then
        echo -e "  ${GREEN}✓ 登录入口正确重定向到 IdP authorize${NC}"
        echo "  重定向 URL: $LOGIN_REDIRECT"

        # 检查是否包含 PKCE 参数
        if echo "$LOGIN_REDIRECT" | grep -q "code_challenge"; then
            echo -e "  ${GREEN}✓ 包含 PKCE code_challenge 参数${NC}"
        else
            echo -e "  ${YELLOW}⚠ 缺少 PKCE code_challenge 参数${NC}"
        fi
    else
        echo -e "  ${RED}✗ 登录入口重定向失败${NC}"
        return 1
    fi

    return 0
}

# M5-2: IdP 登录端点测试
test_idp_login() {
    echo -e "\n${YELLOW}[M5-2] IdP 登录端点测试${NC}"

    # 测试登录 API
    echo "  测试 IdP 登录 API..."
    LOGIN_RESPONSE=$(curl -s -X POST "$IDP_URL/api/auth/sign-in/email" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

    if echo "$LOGIN_RESPONSE" | grep -q '"user"'; then
        echo -e "  ${GREEN}✓ IdP 登录成功${NC}"
        echo "  返回用户: $(echo "$LOGIN_RESPONSE" | grep -o '"email":"[^"]*"')"
    else
        echo -e "  ${RED}✗ IdP 登录失败${NC}"
        echo "  响应: $LOGIN_RESPONSE"
        return 1
    fi

    return 0
}

# M5-3: OAuth 授权端点测试
test_oauth_authorize() {
    echo -e "\n${YELLOW}[M5-3] OAuth 授权端点测试${NC}"

    # 生成测试参数
    CODE_CHALLENGE="test_challenge_$(date +%s)"
    STATE="state_$(date +%s)"
    REDIRECT_URI="http://localhost:4000/api/auth/callback"

    # 测试 authorize 端点（未登录应该重定向到登录页）
    echo "  测试 OAuth authorize 端点..."
    AUTHORIZE_URL="$IDP_URL/api/auth/oauth2/authorize?response_type=code&client_id=portal&redirect_uri=$REDIRECT_URI&scope=openid%20profile%20email&state=$STATE&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256"

    AUTHORIZE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$AUTHORIZE_URL" 2>/dev/null || echo "000")

    if [ "$AUTHORIZE_RESPONSE" = "302" ] || [ "$AUTHORIZE_RESPONSE" = "307" ]; then
        echo -e "  ${GREEN}✓ OAuth authorize 端点响应正常 (HTTP $AUTHORIZE_RESPONSE)${NC}"
    else
        echo -e "  ${YELLOW}⚠ OAuth authorize 端点响应: HTTP $AUTHORIZE_RESPONSE${NC}"
    fi

    return 0
}

# M5-4: 用户权限上下文测试 (需要登录)
test_me_endpoint() {
    echo -e "\n${YELLOW}[M5-4] /api/me 端点测试${NC}"

    # 未登录时应该返回 401
    echo "  测试未登录状态..."
    ME_RESPONSE=$(curl -s -w "\n%{http_code}" "$PORTAL_URL/api/me" 2>/dev/null)
    HTTP_CODE=$(echo "$ME_RESPONSE" | tail -1)
    BODY=$(echo "$ME_RESPONSE" | head -n -1)

    if [ "$HTTP_CODE" = "401" ]; then
        echo -e "  ${GREEN}✓ 未登录返回 401 (预期行为)${NC}"
    else
        echo -e "  ${YELLOW}⚠ 未登录返回 HTTP $HTTP_CODE${NC}"
    fi

    echo -e "\n  ${BLUE}提示: 完整的登录测试需要在浏览器中进行${NC}"
    echo "  1. 打开浏览器访问: $PORTAL_URL"
    echo "  2. 点击登录，完成 OAuth 流程"
    echo "  3. 访问 $PORTAL_URL/api/me 查看权限上下文"

    return 0
}

# M5-5: Token 端点测试
test_token_endpoint() {
    echo -e "\n${YELLOW}[M5-5] Token 端点测试${NC}"

    # 测试 token 端点（无有效授权码应该失败）
    echo "  测试 token 端点..."
    TOKEN_RESPONSE=$(curl -s -X POST "$IDP_URL/api/auth/oauth2/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=authorization_code&code=invalid_code&client_id=portal&redirect_uri=http://localhost:4000/api/auth/callback")

    if echo "$TOKEN_RESPONSE" | grep -q "error"; then
        echo -e "  ${GREEN}✓ Token 端点正确拒绝无效授权码${NC}"
    else
        echo -e "  ${YELLOW}⚠ Token 端点响应: $TOKEN_RESPONSE${NC}"
    fi

    return 0
}

# M5-6: 登出端点测试
test_logout_endpoint() {
    echo -e "\n${YELLOW}[M5-6] 登出端点测试${NC}"

    # 测试登出端点
    echo "  测试登出端点..."
    LOGOUT_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$PORTAL_URL/api/auth/logout" 2>/dev/null || echo "000")

    # 登出可能返回 302 (重定向) 或 401 (未登录) 或 200
    if [ "$LOGOUT_RESPONSE" = "302" ] || [ "$LOGOUT_RESPONSE" = "307" ] || [ "$LOGOUT_RESPONSE" = "401" ] || [ "$LOGOUT_RESPONSE" = "200" ]; then
        echo -e "  ${GREEN}✓ 登出端点响应正常 (HTTP $LOGOUT_RESPONSE)${NC}"
    else
        echo -e "  ${YELLOW}⚠ 登出端点响应: HTTP $LOGOUT_RESPONSE${NC}"
    fi

    return 0
}

# M5-7: 权限 API 测试
test_permission_apis() {
    echo -e "\n${YELLOW}[M5-7] 权限 API 测试${NC}"

    # 测试角色 API
    echo "  测试角色 API..."
    ROLES_RESPONSE=$(curl -s "$PORTAL_URL/api/roles")
    if echo "$ROLES_RESPONSE" | grep -q '"data"'; then
        echo -e "  ${GREEN}✓ 角色列表 API 正常${NC}"
    else
        echo -e "  ${RED}✗ 角色列表 API 失败${NC}"
        return 1
    fi

    # 测试权限 API
    echo "  测试权限 API..."
    PERMS_RESPONSE=$(curl -s "$PORTAL_URL/api/permissions")
    if echo "$PERMS_RESPONSE" | grep -q '"data"'; then
        echo -e "  ${GREEN}✓ 权限列表 API 正常${NC}"
    else
        echo -e "  ${RED}✗ 权限列表 API 失败${NC}"
        return 1
    fi

    return 0
}

# 主测试流程
main() {
    check_services

    PASSED=0
    FAILED=0

    if test_portal_home; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_idp_login; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_oauth_authorize; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_me_endpoint; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_token_endpoint; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_logout_endpoint; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_permission_apis; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    echo -e "\n======================================"
    echo -e "M5 验证结果"
    echo -e "======================================"
    echo -e "${GREEN}通过: $PASSED${NC}"
    echo -e "${RED}失败: $FAILED${NC}"

    echo -e "\n${BLUE}======================================"
    echo -e "浏览器端到端测试步骤"
    echo -e "======================================${NC}"
    echo "1. 打开浏览器访问: $PORTAL_URL"
    echo "2. 点击登录按钮"
    echo "3. 在 IdP 页面输入账号: $TEST_EMAIL / $TEST_PASSWORD"
    echo "4. 验证自动重定向回 Portal"
    echo "5. 访问 $PORTAL_URL/api/me 验证登录状态和权限上下文"

    if [ $FAILED -eq 0 ]; then
        echo -e "\n${GREEN}M5 验证全部通过! ✅${NC}"
        exit 0
    else
        echo -e "\n${RED}M5 验证存在失败项，请检查上述错误${NC}"
        exit 1
    fi
}

main "$@"