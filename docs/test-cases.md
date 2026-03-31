# Auth-SSO 测试用例

## 1. 冒烟测试

### 1.1 Portal 启动测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| SM-001 | Portal 启动 | 访问 http://localhost:4000 | 页面正常加载，重定向到登录页 |
| SM-002 | IdP 启动 | 访问 http://localhost:4001 | 页面正常加载 |
| SM-003 | Demo App 启动 | 访问 http://localhost:4002 | 页面正常加载，显示 SSO 测试页面 |
| SM-004 | 数据库连接 | 调用 /api/users | 返回用户列表或空数组 |
| SM-005 | Redis 连接 | 登录后检查 Redis | Session 存储在 Redis |

### 1.2 基础功能测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| SM-010 | 用户登录 | 点击登录，输入用户名密码 | 登录成功，跳转到首页 |
| SM-011 | 用户信息获取 | 登录后调用 /api/me | 返回当前用户信息 |
| SM-012 | 用户登出 | 点击登出 | 登出成功，跳转到登录页 |

---

## 2. 认证链路测试

### 2.1 登录流程测试

| 编号 | 测试项 | 前置条件 | 步骤 | 预期结果 |
|------|--------|----------|------|----------|
| AUTH-001 | 首次登录跳转 | 未登录 | 访问 Portal 受保护页面 | 自动跳转到 IdP 登录页 |
| AUTH-002 | OAuth 授权码获取 | 未登录，在 IdP 登录页 | 输入正确凭证 | 跳转回 Portal，携带 code 参数 |
| AUTH-003 | Token 交换 | 获得授权码 | 系统自动处理 | 成功获取 access_token |
| AUTH-004 | Session 创建 | Token 交换成功 | 系统自动处理 | Redis 中创建 Session |
| AUTH-005 | Cookie 设置 | Session 创建成功 | 检查 Cookie | portal_session_id Cookie 正确设置 |

### 2.2 State/Nonce/PKCE 测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| AUTH-010 | State 验证-正确 | 正常登录流程 | state 匹配，登录成功 |
| AUTH-011 | State 验证-错误 | 篡改 URL 中的 state | 返回 invalid_state 错误 |
| AUTH-012 | State 过期 | 登录流程暂停超过 10 分钟 | 返回 state_expired 错误 |
| AUTH-013 | PKCE 验证 | 检查 token 请求 | 包含 code_verifier 参数 |
| AUTH-014 | Nonce 生成 | 检查授权 URL | 包含 nonce 参数 |

### 2.3 登出流程测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| AUTH-020 | Portal 登出 | 点击登出 | Portal Session 清除 |
| AUTH-021 | IdP Session 清除 | 登出后检查 IdP | IdP Session 同步清除 |
| AUTH-022 | 登出后访问 | 登出后访问受保护页面 | 重定向到登录页 |
| AUTH-023 | 重新登录 | 登出后重新登录 | 需要重新输入凭证（除非 IdP Session 未清除） |

---

## 3. Session 测试

### 3.1 Session 存储测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| SESS-001 | Redis 存储 | 登录后检查 Redis key | portal:session:{id} 存在 |
| SESS-002 | Session 内容 | 读取 Session 内容 | 包含 userId, accessToken, createdAt 等 |
| SESS-003 | Session 过期设置 | 检查 TTL | TTL 等于 absolute timeout |

### 3.2 Session 过期测试

| 编号 | 测试项 | 前置条件 | 步骤 | 预期结果 |
|------|--------|----------|------|----------|
| SESS-010 | Idle timeout | 登录后等待 30 分钟不操作 | 再次请求 | 返回 401，需要重新登录 |
| SESS-011 | Absolute timeout | 登录后等待 7 天 | 发起请求 | 返回 401，需要重新登录 |
| SESS-012 | 活跃续期 | 登录后持续操作 | 29 分钟后请求 | lastAccessAt 更新，Session 有效 |

### 3.3 Token 刷新测试

| 编号 | 测试项 | 前置条件 | 步骤 | 预期结果 |
|------|--------|----------|------|----------|
| SESS-020 | Token 即将过期 | access_token 剩余 < 5 分钟 | 发起请求 | 自动刷新 Token |
| SESS-021 | Token 刷新成功 | 触发刷新 | 检查 Session | access_token 更新 |
| SESS-022 | Token 刷新失败 | refresh_token 失效 | 发起请求 | Session 销毁，重定向登录 |

---

## 4. 权限测试

### 4.1 API 权限测试

| 编号 | 测试项 | 前置条件 | 步骤 | 预期结果 |
|------|--------|----------|------|----------|
| PERM-001 | 无权限访问 API | 用户无 user:list 权限 | GET /api/users | 返回 403 Forbidden |
| PERM-002 | 有权限访问 API | 用户有 user:list 权限 | GET /api/users | 返回用户列表 |
| PERM-003 | 未登录访问 API | 无 Session | GET /api/users | 返回 401 Unauthorized |
| PERM-004 | 创建权限检查 | 用户无 user:create 权限 | POST /api/users | 返回 403 Forbidden |

### 4.2 菜单权限测试

| 编号 | 测试项 | 前置条件 | 步骤 | 预期结果 |
|------|--------|----------|------|----------|
| PERM-010 | 无权限菜单隐藏 | 用户无 user:list 权限 | 访问 Portal | 用户管理菜单不显示 |
| PERM-011 | 有权限菜单显示 | 用户有 user:list 权限 | 访问 Portal | 用户管理菜单显示 |
| PERM-012 | 部分权限菜单 | 用户有部分权限 | 访问 Portal | 只显示有权限的菜单 |

### 4.3 角色变更测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| PERM-020 | 角色新增 | 给用户添加新角色 | 新角色权限立即生效 |
| PERM-021 | 角色移除 | 移除用户角色 | 对应权限立即失效 |
| PERM-022 | 权限变更 | 修改角色权限 | 用户权限立即更新 |

---

## 5. SSO 测试

### 5.1 单点登录测试

| 编号 | 测试项 | 前置条件 | 步骤 | 预期结果 |
|------|--------|----------|------|----------|
| SSO-001 | Portal 登录后 Demo 免登 | Portal 已登录 | 访问 Demo App SSO 登录 | 自动完成认证，显示用户信息 |
| SSO-002 | Demo 登录后 Portal 免登 | Demo App 已登录 | 访问 Portal | 自动完成认证 |
| SSO-003 | 未登录访问 Demo | 未在任何应用登录 | 访问 Demo App SSO 登录 | 跳转到 IdP 登录页 |

### 5.2 单点登出测试

| 编号 | 测试项 | 前置条件 | 步骤 | 预期结果 |
|------|--------|----------|------|----------|
| SSO-010 | Portal 登出后 Demo | 两个应用都已登录 | Portal 登出 | Demo App 也需重新登录 |
| SSO-011 | Demo 登出后 Portal | 两个应用都已登录 | Demo App 登出 | Portal 也需重新登录 |

---

## 6. 安全测试

### 6.1 Cookie 安全测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| SEC-001 | HttpOnly 属性 | 检查 Cookie | portal_session_id 设置了 HttpOnly |
| SEC-002 | Secure 属性 | 生产环境检查 Cookie | 设置了 Secure |
| SEC-003 | SameSite 属性 | 检查 Cookie | 设置为 lax |

### 6.2 Token 安全测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| SEC-010 | Token 不在 URL | 检查浏览器地址栏 | Token 不出现在 URL |
| SEC-011 | Token 不在 localStorage | 检查浏览器存储 | Token 不在 localStorage |
| SEC-012 | Token 不在 sessionStorage | 检查浏览器存储 | Token 不在 sessionStorage |

### 6.3 回调地址白名单测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| SEC-020 | 合法回调地址 | 使用注册的 redirect_uri | 正常跳转 |
| SEC-021 | 非法回调地址 | 使用未注册的 redirect_uri | 拒绝授权请求 |

### 6.4 重放攻击测试

| 编号 | 测试项 | 步骤 | 预期结果 |
|------|--------|------|----------|
| SEC-030 | 重放授权码 | 使用已使用的 code | 请求被拒绝 |
| SEC-031 | 重放 state | 使用已过期的 state | 请求被拒绝 |

---

## 7. 性能测试

### 7.1 登录性能测试

| 编号 | 测试项 | 预期结果 |
|------|--------|----------|
| PERF-001 | 登录响应时间 | < 2 秒 |
| PERF-002 | Token 交换时间 | < 500ms |
| PERF-003 | Session 查询时间 | < 10ms |

---

## 8. 测试执行清单

### 8.1 测试环境准备

- [ ] 启动 Redis
- [ ] 启动 PostgreSQL
- [ ] 启动 IdP (port 4001)
- [ ] 启动 Portal (port 4000)
- [ ] 启动 Demo App (port 4002)
- [ ] 创建测试用户
- [ ] 创建测试角色和权限

### 8.2 测试数据准备

```sql
-- 创建测试用户
INSERT INTO users (id, public_id, username, email, name, password, status) VALUES
('test-user-1', 'usr_test1', 'testuser1', 'test1@example.com', '测试用户1', '$2a$10...', 'ACTIVE');

-- 创建测试角色
INSERT INTO roles (id, public_id, name, code, status) VALUES
('test-role-1', 'role_test1', '测试角色', 'TEST_ROLE', 'ACTIVE');

-- 创建测试权限
INSERT INTO permissions (id, public_id, name, code, type, status) VALUES
('test-perm-1', 'perm_test1', '用户列表', 'user:list', 'API', 'ACTIVE');
```

### 8.3 测试结果记录

| 测试类别 | 通过数 | 失败数 | 备注 |
|----------|--------|--------|------|
| 冒烟测试 | | | |
| 认证测试 | | | |
| Session 测试 | | | |
| 权限测试 | | | |
| SSO 测试 | | | |
| 安全测试 | | | |
| 性能测试 | | | |
| **总计** | | | |

### 8.4 缺陷记录

| 编号 | 严重程度 | 描述 | 状态 |
|------|----------|------|------|
| | | | |

---

## 9. 自动化测试脚本示例

### 9.1 登录流程测试脚本

```bash
#!/bin/bash
# test-login.sh

echo "=== 测试登录流程 ==="

# 1. 检查未登录状态
echo "1. 检查未登录状态..."
curl -s http://localhost:4000/api/me | jq .

# 2. 发起登录请求
echo "2. 发起登录请求..."
curl -s -c cookies.txt -b cookies.txt -L http://localhost:4000/api/auth/login -o /dev/null -w "%{url_effective}\n"

# 3. 检查登录后状态
echo "3. 检查登录后状态..."
curl -s -b cookies.txt http://localhost:4000/api/me | jq .

# 4. 登出
echo "4. 登出..."
curl -s -b cookies.txt -X POST http://localhost:4000/api/auth/logout | jq .

# 5. 确认登出状态
echo "5. 确认登出状态..."
curl -s -b cookies.txt http://localhost:4000/api/me | jq .

echo "=== 测试完成 ==="
```

### 9.2 API 权限测试脚本

```bash
#!/bin/bash
# test-permissions.sh

echo "=== 测试 API 权限 ==="

# 无权限用户访问
echo "1. 无权限用户访问 /api/users..."
curl -s -b cookies_no_perm.txt http://localhost:4000/api/users | jq .

# 有权限用户访问
echo "2. 有权限用户访问 /api/users..."
curl -s -b cookies_with_perm.txt http://localhost:4000/api/users | jq .

echo "=== 测试完成 ==="
```