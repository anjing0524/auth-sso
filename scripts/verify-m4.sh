#!/bin/bash

# M4 权限中心验证脚本
# 验证角色、权限、用户角色绑定、角色权限绑定功能

set -e

PORTAL_URL="http://localhost:4000"
IDP_URL="http://localhost:4001"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "======================================"
echo "M4 权限中心验证"
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

# M4-1: 角色 CRUD 测试
test_role_crud() {
    echo -e "\n${YELLOW}[M4-1] 角色 CRUD 测试${NC}"

    # 创建角色
    echo "  创建测试角色..."
    ROLE_RESPONSE=$(curl -s -X POST "$PORTAL_URL/api/roles" \
        -H "Content-Type: application/json" \
        -d '{"name":"测试角色","code":"test_role_m4","description":"M4验证测试角色","dataScopeType":"SELF"}')

    if echo "$ROLE_RESPONSE" | grep -q '"success":true'; then
        echo -e "  ${GREEN}✓ 创建角色成功${NC}"
        ROLE_ID=$(echo "$ROLE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo "  角色ID: $ROLE_ID"
    else
        # 可能角色已存在
        if echo "$ROLE_RESPONSE" | grep -q 'role_exists'; then
            echo -e "  ${YELLOW}⚠ 角色已存在，获取现有角色${NC}"
            ROLES=$(curl -s "$PORTAL_URL/api/roles?keyword=test_role_m4")
            ROLE_ID=$(echo "$ROLES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        else
            echo -e "  ${RED}✗ 创建角色失败: $ROLE_RESPONSE${NC}"
            return 1
        fi
    fi

    # 获取角色列表
    echo "  获取角色列表..."
    ROLES_LIST=$(curl -s "$PORTAL_URL/api/roles")
    if echo "$ROLES_LIST" | grep -q '"data"'; then
        ROLE_COUNT=$(echo "$ROLES_LIST" | grep -o '"id"' | wc -l | tr -d ' ')
        echo -e "  ${GREEN}✓ 获取角色列表成功，共 $ROLE_COUNT 个角色${NC}"
    else
        echo -e "  ${RED}✗ 获取角色列表失败${NC}"
        return 1
    fi

    return 0
}

# M4-2: 权限 CRUD 测试
test_permission_crud() {
    echo -e "\n${YELLOW}[M4-2] 权限 CRUD 测试${NC}"

    # 创建权限
    echo "  创建测试权限..."
    PERM_RESPONSE=$(curl -s -X POST "$PORTAL_URL/api/permissions" \
        -H "Content-Type: application/json" \
        -d '{"name":"测试查看","code":"test:read_m4","type":"API","resource":"test","action":"read"}')

    if echo "$PERM_RESPONSE" | grep -q '"success":true'; then
        echo -e "  ${GREEN}✓ 创建权限成功${NC}"
        PERM_ID=$(echo "$PERM_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo "  权限ID: $PERM_ID"
    else
        if echo "$PERM_RESPONSE" | grep -q 'permission_exists'; then
            echo -e "  ${YELLOW}⚠ 权限已存在，获取现有权限${NC}"
            PERMS=$(curl -s "$PORTAL_URL/api/permissions")
            PERM_ID=$(echo "$PERMS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        else
            echo -e "  ${RED}✗ 创建权限失败: $PERM_RESPONSE${NC}"
            return 1
        fi
    fi

    # 获取权限列表
    echo "  获取权限列表..."
    PERMS_LIST=$(curl -s "$PORTAL_URL/api/permissions")
    if echo "$PERMS_LIST" | grep -q '"data"'; then
        PERM_COUNT=$(echo "$PERMS_LIST" | grep -o '"id"' | wc -l | tr -d ' ')
        echo -e "  ${GREEN}✓ 获取权限列表成功，共 $PERM_COUNT 个权限${NC}"
    else
        echo -e "  ${RED}✗ 获取权限列表失败${NC}"
        return 1
    fi

    return 0
}

# M4-3: 用户角色分配测试
test_user_role_assignment() {
    echo -e "\n${YELLOW}[M4-3] 用户角色分配测试${NC}"

    # 获取用户列表
    echo "  获取用户列表..."
    USERS=$(curl -s "$PORTAL_URL/api/users")
    USER_ID=$(echo "$USERS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -z "$USER_ID" ]; then
        echo -e "  ${RED}✗ 未找到用户${NC}"
        return 1
    fi
    echo "  用户ID: $USER_ID"

    # 获取角色ID
    ROLES=$(curl -s "$PORTAL_URL/api/roles")
    ROLE_ID=$(echo "$ROLES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -z "$ROLE_ID" ]; then
        echo -e "  ${RED}✗ 未找到角色${NC}"
        return 1
    fi
    echo "  角色ID: $ROLE_ID"

    # 分配角色
    echo "  为用户分配角色..."
    ASSIGN_RESPONSE=$(curl -s -X POST "$PORTAL_URL/api/users/$USER_ID/roles" \
        -H "Content-Type: application/json" \
        -d "{\"roleIds\":[\"$ROLE_ID\"]}")

    if echo "$ASSIGN_RESPONSE" | grep -q '"success":true'; then
        echo -e "  ${GREEN}✓ 分配角色成功${NC}"
    else
        echo -e "  ${YELLOW}⚠ 分配角色响应: $ASSIGN_RESPONSE${NC}"
    fi

    # 获取用户角色
    echo "  获取用户角色..."
    USER_ROLES=$(curl -s "$PORTAL_URL/api/users/$USER_ID/roles")
    if echo "$USER_ROLES" | grep -q '"data"'; then
        echo -e "  ${GREEN}✓ 获取用户角色成功${NC}"
        echo "  $USER_ROLES" | head -c 200
        echo ""
    else
        echo -e "  ${RED}✗ 获取用户角色失败${NC}"
        return 1
    fi

    return 0
}

# M4-4: 角色权限分配测试
test_role_permission_assignment() {
    echo -e "\n${YELLOW}[M4-4] 角色权限分配测试${NC}"

    # 获取角色ID
    ROLES=$(curl -s "$PORTAL_URL/api/roles")
    ROLE_ID=$(echo "$ROLES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -z "$ROLE_ID" ]; then
        echo -e "  ${RED}✗ 未找到角色${NC}"
        return 1
    fi

    # 获取权限ID
    PERMS=$(curl -s "$PORTAL_URL/api/permissions")
    PERM_ID=$(echo "$PERMS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -z "$PERM_ID" ]; then
        echo -e "  ${RED}✗ 未找到权限${NC}"
        return 1
    fi

    # 为角色分配权限
    echo "  为角色分配权限 (角色: $ROLE_ID, 权限: $PERM_ID)..."
    ASSIGN_RESPONSE=$(curl -s -X POST "$PORTAL_URL/api/roles/$ROLE_ID/permissions" \
        -H "Content-Type: application/json" \
        -d "{\"permissionIds\":[\"$PERM_ID\"]}")

    if echo "$ASSIGN_RESPONSE" | grep -q '"success":true'; then
        echo -e "  ${GREEN}✓ 分配权限成功${NC}"
    else
        echo -e "  ${YELLOW}⚠ 分配权限响应: $ASSIGN_RESPONSE${NC}"
    fi

    # 获取角色权限
    echo "  获取角色权限..."
    ROLE_PERMS=$(curl -s "$PORTAL_URL/api/roles/$ROLE_ID/permissions")
    if echo "$ROLE_PERMS" | grep -q '"data"'; then
        echo -e "  ${GREEN}✓ 获取角色权限成功${NC}"
        echo "  $ROLE_PERMS" | head -c 200
        echo ""
    else
        echo -e "  ${RED}✗ 获取角色权限失败${NC}"
        return 1
    fi

    return 0
}

# M4-5: /api/me 权限上下文测试
test_me_permissions() {
    echo -e "\n${YELLOW}[M4-5] /api/me 权限上下文测试${NC}"

    # 直接调用 /api/me (可能未登录)
    echo "  调用 /api/me..."
    ME_RESPONSE=$(curl -s "$PORTAL_URL/api/me")

    if echo "$ME_RESPONSE" | grep -q '"user"'; then
        echo -e "  ${GREEN}✓ 获取用户信息成功${NC}"

        # 检查是否包含权限上下文
        if echo "$ME_RESPONSE" | grep -q '"permissions"'; then
            echo -e "  ${GREEN}✓ 包含 permissions 字段${NC}"
        else
            echo -e "  ${YELLOW}⚠ 缺少 permissions 字段${NC}"
        fi

        if echo "$ME_RESPONSE" | grep -q '"roles"'; then
            echo -e "  ${GREEN}✓ 包含 roles 字段${NC}"
        else
            echo -e "  ${YELLOW}⚠ 缺少 roles 字段${NC}"
        fi

        if echo "$ME_RESPONSE" | grep -q '"dataScopeType"'; then
            echo -e "  ${GREEN}✓ 包含 dataScopeType 字段${NC}"
        else
            echo -e "  ${YELLOW}⚠ 缺少 dataScopeType 字段${NC}"
        fi

        echo "  响应: "
        echo "  $ME_RESPONSE" | head -c 300
        echo ""
    else
        if echo "$ME_RESPONSE" | grep -q '"error"'; then
            echo -e "  ${YELLOW}⚠ 未登录或 Session 过期${NC}"
            echo "  请先通过浏览器登录 Portal，然后使用 cookie 重新测试"
        else
            echo -e "  ${RED}✗ 获取用户信息失败${NC}"
        fi
        return 1
    fi

    return 0
}

# 主测试流程
main() {
    check_services

    PASSED=0
    FAILED=0

    if test_role_crud; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_permission_crud; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_user_role_assignment; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_role_permission_assignment; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    if test_me_permissions; then
        ((PASSED++))
    else
        ((FAILED++))
    fi

    echo -e "\n======================================"
    echo -e "M4 验证结果"
    echo -e "======================================"
    echo -e "${GREEN}通过: $PASSED${NC}"
    echo -e "${RED}失败: $FAILED${NC}"

    if [ $FAILED -eq 0 ]; then
        echo -e "\n${GREEN}M4 验证全部通过! ✅${NC}"
        exit 0
    else
        echo -e "\n${RED}M4 验证存在失败项，请检查上述错误${NC}"
        exit 1
    fi
}

main "$@"