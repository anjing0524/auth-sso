# Auth-SSO API 接口规范

**版本：** v1.0
**状态：** 正式发布
**最后更新：** 2026-06-26
**来源：** 整合自 ARCHITECTURE.md §8、DETAILED_DESIGN.md §9、USER_STORIES.md §19

---

## 1. 全局约定

### 1.1 基础 URL

| 环境 | Base URL |
|------|---------|
| 本地开发 | `http://localhost:4100` |
| Docker | `http://portal:4000`（内部）/ `https://<domain>`（Gateway） |
| 生产环境 | `https://<your-domain>`（经 Gateway HTTPS） |

### 1.2 认证方式

| 端点类别 | 认证方式 |
|---------|---------|
| 管理 API（`/api/users`、`/api/roles` 等） | Cookie `portal_jwt_token`（HttpOnly）或 `Authorization: Bearer <JWT>` |
| OIDC Provider（`/api/auth/oauth2/*`） | OAuth 2.1 客户端认证（`client_id` + `client_secret`） |
| 公开端点（`/api/auth/login`、`/api/auth/jwks`、`/.well-known/*`） | 无需认证 |
| `/api/me` 系列 | Cookie `portal_jwt_token` 或 `Authorization: Bearer <JWT>` |

### 1.3 响应格式

所有 API 返回统一 JSON 格式：

```json
// 成功响应
{ "success": true, "data": { ... } }

// 列表响应
{ "success": true, "data": [...], "total": 100, "page": 1, "pageSize": 20 }

// 错误响应
{ "success": false, "error": "ERROR_CODE", "message": "人类可读的中文错误描述" }
```

HTTP 状态码遵循 REST 惯例：
- `200 OK` — 成功
- `201 Created` — 创建成功
- `400 Bad Request` — 参数校验失败
- `401 Unauthorized` — 未认证
- `403 Forbidden` — 无权限
- `404 Not Found` — 资源不存在
- `409 Conflict` — 业务规则冲突
- `422 Unprocessable Entity` — 领域规则违反
- `423 Locked` — 账户锁定
- `429 Too Many Requests` — 限流
- `500 Internal Server Error` — 服务器内部错误

### 1.4 分页约定

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | integer | 1 | 页码（1-based） |
| `pageSize` | integer | 20 | 每页条数（最大 100） |

---

## 2. 认证 API

### 2.1 登录

```
POST /api/auth/login
```

**请求体：**
```json
{ "email": "admin@example.com", "password": "your-password" }
```

**成功响应（200）：**
```json
{ "success": true }
```
同时设置 `Set-Cookie: login_session=<JWT>; Path=/api/auth/oauth2/authorize; HttpOnly; ...`

**错误响应：**
- `400 VALIDATION_ERROR` — 邮箱或密码格式错误
- `404 ENTITY_NOT_FOUND` — 用户不存在
- `422 BUSINESS_RULE_VIOLATION` — 邮箱或密码错误
- `423 ACCOUNT_LOCKED` — 连续 5 次登录失败，账户临时锁定

**安全特性：** 连续 5 次失败后 15 分钟内禁止登录。失败计数基于 `login_logs` 表。

### 2.2 登出

```
POST /api/auth/logout
GET /api/auth/logout
```

**认证：** 需要携带 `portal_jwt_token` Cookie。

**成功响应（200）：**
```json
{ "success": true }
```
同时清除 `portal_jwt_token`、`portal_refresh_token`、`login_session` Cookie，并将当前 JWT 的 jti 写入 Redis 黑名单。

### 2.3 Token 刷新

```
POST /api/auth/refresh
```

**认证：** 需要携带 `portal_refresh_token` Cookie。

**成功响应（200）：**
```json
{ "success": true }
```
同时设置新的 `portal_jwt_token` 和 `portal_refresh_token` Cookie（Token Rotation）。

**错误响应：**
- `401 TOKEN_INVALID` — Refresh Token 无效或已撤销
- `401 TOKEN_EXPIRED` — Refresh Token 已过期

### 2.4 OAuth 回调

```
GET /api/auth/callback?code=<authorization_code>&state=<state>&pkce_verifier=<code_verifier>
```

Portal BFF 内部端点，处理 OAuth 授权码回调。通过后端通信调用 Token 端点完成令牌交换。

---

## 3. OIDC Provider API

### 3.1 OIDC Discovery

```
GET /.well-known/openid-configuration
```

返回标准 OIDC Discovery 元数据，包含 issuer、authorization_endpoint、token_endpoint、jwks_uri 等字段。

### 3.2 JWKS 公钥集

```
GET /.well-known/jwks
GET /api/auth/jwks
```

返回 JWK Set 格式的 ES256 公钥列表，用于 JWT 离线验证。

**响应示例：**
```json
{
  "keys": [
    {
      "kty": "EC",
      "crv": "P-256",
      "kid": "<key-id>",
      "x": "<base64url>",
      "y": "<base64url>",
      "alg": "ES256",
      "use": "sig"
    }
  ]
}
```

### 3.3 授权端点

```
GET /api/auth/oauth2/authorize
```

**参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `response_type` | 是 | 固定值 `code` |
| `client_id` | 是 | OAuth 客户端 ID |
| `redirect_uri` | 是 | 回调 URL（须与注册的完全一致） |
| `scope` | 是 | 空格分隔的作用域（如 `openid profile email`） |
| `state` | 是 | CSRF 防护随机字符串 |
| `code_challenge` | 是 | PKCE S256 Code Challenge |
| `code_challenge_method` | 是 | 固定值 `S256` |
| `nonce` | 否 | OIDC nonce |

**认证：** 用户须通过 `login_session` Cookie 或 `portal_jwt_token` Cookie 提供有效会话。

**成功响应：** 302 重定向到 `redirect_uri?code=<authorization_code>&state=<state>`

**安全约束：**
- PKCE S256 强制要求（`code_challenge` + `code_challenge_method=S256` 均为必填）
- `redirect_uri` 必须与 Client 注册值精确匹配（含末尾斜杠）
- 授权码 TTL 5 分钟，一次性使用

### 3.4 Token 端点

```
POST /api/auth/oauth2/token
```

**请求体（authorization_code 模式）：**
```
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<authorization_code>
&code_verifier=<pkce_code_verifier>
&client_id=<client_id>
&client_secret=<client_secret>
&redirect_uri=<redirect_uri>
```

**请求体（refresh_token 模式）：**
```
grant_type=refresh_token
&refresh_token=<refresh_token>
&client_id=<client_id>
&client_secret=<client_secret>
```

**成功响应（authorization_code）：**
```json
{
  "access_token": "<ES256 JWT>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "<opaque_token>",
  "id_token": "<ES256 JWT>",
  "scope": "openid profile email"
}
```

**错误响应：**
- `400 invalid_grant` — 授权码无效/已过期/已使用
- `400 invalid_client` — Client 认证失败
- `400 invalid_request` — PKCE 验证失败

### 3.5 UserInfo 端点

```
GET /api/auth/oauth2/userinfo
POST /api/auth/oauth2/userinfo
```

**认证：** `Authorization: Bearer <access_token>` 或 Cookie `portal_jwt_token`

**成功响应（200）：**
```json
{
  "sub": "<user-id>",
  "name": "张三",
  "email": "zhangsan@example.com",
  "preferred_username": "zhangsan",
  "email_verified": true
}
```

### 3.6 Introspection 端点

```
POST /api/auth/oauth2/introspect
```

**请求体：**
```
Content-Type: application/x-www-form-urlencoded

token=<access_token_or_refresh_token>
&client_id=<client_id>
&client_secret=<client_secret>
```

**成功响应（200）：**
```json
{
  "active": true,
  "sub": "<user-id>",
  "client_id": "<client-id>",
  "exp": 1719000000,
  "iat": 1718996400,
  "scope": "openid profile",
  "token_type": "Bearer"
}
```

### 3.7 Revocation 端点

```
POST /api/auth/oauth2/revoke
```

**请求体：**
```
Content-Type: application/x-www-form-urlencoded

token=<token>
&client_id=<client_id>
&client_secret=<client_secret>
```

**成功响应（200）：** 空响应体。Token 的 jti 被写入 Redis 黑名单。

---

## 4. 当前用户 API（/api/me）

### 4.1 获取当前用户信息

```
GET /api/me
```

**认证：** Cookie `portal_jwt_token` 或 `Authorization: Bearer <JWT>`

**响应：**
```json
{
  "success": true,
  "data": {
    "id": "<uuid>",
    "username": "admin",
    "email": "admin@example.com",
    "name": "系统管理员",
    "status": "ACTIVE",
    "deptId": "<uuid>",
    "deptName": "总公司",
    "roles": ["SUPER_ADMIN"],
    "permissions": ["user:list", "user:create", ...]
  }
}
```

### 4.2 获取当前用户权限

```
GET /api/me/permissions
```

**响应：**
```json
{
  "success": true,
  "data": {
    "roles": ["SUPER_ADMIN"],
    "permissions": ["user:list", "user:create", "user:read", ...],
    "deptIds": ["<uuid>", ...]
  }
}
```

### 4.3 获取当前用户菜单

```
GET /api/me/menus
```

**响应：**
```json
{
  "success": true,
  "data": [
    {
      "id": "<uuid>",
      "name": "用户管理",
      "path": "/users",
      "icon": "users",
      "parentId": null,
      "children": [...]
    }
  ]
}
```

菜单根据用户权限动态过滤，无权限的菜单项不返回。

---

## 5. 用户管理 API（/api/users）

**所有端点需要 `portal_jwt_token` 认证。数据范围受角色部门约束。**

### 5.1 用户列表

```
GET /api/users?page=1&pageSize=20&keyword=张三&status=ACTIVE&deptId=<uuid>
```

**权限：** `user:list`

**响应：**
```json
{
  "success": true,
  "data": [
    {
      "id": "<uuid>",
      "username": "zhangsan",
      "email": "zhangsan@example.com",
      "name": "张三",
      "status": "ACTIVE",
      "deptId": "<uuid>",
      "deptName": "技术部",
      "roles": ["developer"],
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

### 5.2 创建用户

```
POST /api/users
```

**权限：** `user:create`

**请求体：**
```json
{
  "username": "zhangsan",
  "name": "张三",
  "email": "zhangsan@example.com",
  "password": "SecureP@ss1",
  "deptId": "<dept-uuid>"
}
```

**约束：** 用户名和邮箱全局唯一。密码至少 8 位，含大小写字母和数字。

### 5.3 查看用户详情

```
GET /api/users/:id
```

**权限：** `user:read`

**约束：** 只能查看数据权限范围内的用户。

### 5.4 更新用户

```
PUT /api/users/:id
```

**权限：** `user:update`

**请求体：**
```json
{
  "name": "张三丰",
  "email": "zhangsanfeng@example.com",
  "deptId": "<new-dept-uuid>"
}
```

### 5.5 删除用户

```
DELETE /api/users/:id
```

**权限：** `user:delete`

**行为：** 软删除（设置 status=DELETED），同时撤销用户所有活跃 Token。

### 5.6 重置用户密码

```
POST /api/users/:id/reset-password
```

**权限：** `user:reset_password`

**请求体：**
```json
{ "password": "NewSecureP@ss1" }
```

**副作用：** 重置后当前用户的所有活跃 JWT 被撤销（jti 入黑名单），用户需重新登录。

### 5.7 管理用户角色

```
GET /api/users/:id/roles
POST /api/users/:id/roles
DELETE /api/users/:id/roles
```

**权限：** `user:assign_role`

**POST 请求体：**
```json
{ "roleIds": ["<role-uuid-1>", "<role-uuid-2>"] }
```

**DELETE 请求体：**
```json
{ "roleId": "<role-uuid>" }
```

**副作用：** 角色变更后清除用户权限缓存，撤销用户当前 Token 强制重新登录。

### 5.8 强制下线

```
POST /api/users/:id/force-logout
```

**权限：** `user:manage`

**行为：** 撤销该用户所有活跃 JWT（所有 jti 入黑名单）。

---

## 6. 角色管理 API（/api/roles）

### 6.1 角色列表

```
GET /api/roles?page=1&pageSize=20&keyword=管理员&status=ACTIVE
```

**权限：** `role:list`

### 6.2 创建角色

```
POST /api/roles
```

**权限：** `role:create`

**请求体：**
```json
{
  "name": "部门管理员",
  "code": "dept_admin",
  "deptId": "<dept-uuid>",
  "description": "部门级管理员角色"
}
```

**约束：** `code` 全局唯一、不可修改；`deptId` 不可为空。

### 6.3 查看角色

```
GET /api/roles/:id
```

**权限：** `role:read`

### 6.4 更新角色

```
PUT /api/roles/:id
```

**权限：** `role:update`

**请求体：**
```json
{
  "name": "部门管理员（扩展）",
  "description": "扩展权限的部门管理员"
}
```

**约束：** 不可修改 `code`；系统内置角色（`SUPER_ADMIN`/`ADMIN`）不可编辑。

### 6.5 删除角色

```
DELETE /api/roles/:id
```

**权限：** `role:delete`

**约束：** 系统内置角色不可删除。删除时级联解绑用户和权限，清除受影响用户缓存。

### 6.6 角色权限管理

```
GET /api/roles/:id/permissions
PUT /api/roles/:id/permissions
```

**权限：** `role:assign_permission`

**PUT 请求体：**
```json
{ "permissionIds": ["<perm-uuid-1>", "<perm-uuid-2>"] }
```

---

## 7. 权限管理 API（/api/permissions）

### 7.1 权限列表

```
GET /api/permissions?type=API
```

**权限：** `permission:list`

**参数：** `type` 可选值：`DIRECTORY` | `PAGE` | `API` | `DATA`

### 7.2 创建权限

```
POST /api/permissions
```

**权限：** `permission:create`

**请求体：**
```json
{
  "code": "user:export",
  "name": "导出用户",
  "type": "API",
  "resource": "/api/users/export",
  "action": "POST",
  "clientId": "<client-id>",
  "parentId": "<parent-permission-id>"
}
```

### 7.3 更新权限

```
PUT /api/permissions/:id
```

**权限：** `permission:update`

### 7.4 删除权限

```
DELETE /api/permissions/:id
```

**权限：** `permission:delete`

### 7.5 权限注册（Client 自注册）

```
POST /api/permissions/register
```

**认证：** HTTP Basic Auth（`client_id:client_secret`）

**请求体：**
```json
{
  "permissions": [
    {
      "code": "myapp:read",
      "name": "读取数据",
      "type": "API",
      "resource": "/api/v1/data",
      "action": "GET"
    }
  ]
}
```

---

## 8. 部门管理 API（/api/departments）

### 8.1 部门列表（组织树）

```
GET /api/departments
```

**权限：** `department:list`

**响应：** 树形结构，每个节点含 `id`、`name`、`code`、`parentId`、`children`、`ancestors`（物化路径）。

### 8.2 创建部门

```
POST /api/departments
```

**权限：** `department:create`

**请求体：**
```json
{
  "name": "前端组",
  "code": "frontend",
  "parentId": "<parent-dept-uuid>"
}
```

**约束：** `code` 全局唯一；`parentId` 必须指向存在的部门。

### 8.3 查看部门

```
GET /api/departments/:id
```

**权限：** `department:read`

### 8.4 更新部门

```
PUT /api/departments/:id
```

**权限：** `department:update`

### 8.5 删除部门

```
DELETE /api/departments/:id
```

**权限：** `department:delete`

**约束：** 含子部门的节点不可删除；含绑定用户的部门不可删除。

### 8.6 部门成员

```
GET /api/departments/:id/members
```

**权限：** `user:list`

---

## 9. 应用管理 API（/api/clients）

### 9.1 Client 列表

```
GET /api/clients?page=1&pageSize=20&keyword=我的应用&status=ACTIVE
```

**权限：** `client:list`

### 9.2 注册 Client

```
POST /api/clients
```

**权限：** `client:create`

**请求体：**
```json
{
  "name": "我的子应用",
  "redirectUris": ["https://myapp.example.com/callback"],
  "scopes": ["openid", "profile", "email"],
  "grantTypes": ["authorization_code", "refresh_token"]
}
```

**响应：** 返回 `client_id` 和 `client_secret`（仅此一次，须妥善保存）。

### 9.3 查看 Client

```
GET /api/clients/:id
```

**权限：** `client:read`

### 9.4 更新 Client

```
PUT /api/clients/:id
```

**权限：** `client:update`

### 9.5 删除 Client

```
DELETE /api/clients/:id
```

**权限：** `client:delete`

### 9.6 轮换 Client Secret

```
POST /api/clients/:id/secret
```

**权限：** `client:rotate_secret`

**行为：** 生成新 Secret，旧 Secret 即时失效。返回新 Secret（仅此一次）。

### 9.7 Client Token 管理

```
GET /api/clients/:id/tokens
DELETE /api/clients/:id/tokens
```

**权限：** `client:read` / `client:update`

---

## 10. 审计日志 API（/api/audit）

### 10.1 操作审计日志

```
GET /api/audit/logs?page=1&pageSize=20&userId=<uuid>&operation=UPDATE&startDate=2026-01-01&endDate=2026-06-30
```

**权限：** `audit:read`

**响应：**
```json
{
  "success": true,
  "data": [
    {
      "id": "<uuid>",
      "userId": "<user-uuid>",
      "username": "admin",
      "operation": "UPDATE",
      "targetType": "user",
      "targetId": "<uuid>",
      "params": { "name": "张三丰" },
      "ip": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "createdAt": "2026-06-26T10:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

### 10.2 登录日志

```
GET /api/audit/login-logs?page=1&pageSize=20&userId=<uuid>&eventType=LOGIN_FAILED&startDate=2026-01-01&endDate=2026-06-30
```

**权限：** `audit:read`

---

## 11. Gateway 注入头

Gateway 在转发请求到 Portal 时注入以下 HTTP 头：

| Header | 说明 |
|--------|------|
| `X-User-Id` | 已验证的用户 ID（小写规范） |
| `X-User-Jti` | JWT 的 jti 声明 |
| `X-Client-IP` | 客户端真实 IP |
| `X-Client-UA` | 客户端 User-Agent |
| `Authorization` | `Bearer <JWT>`（原始 Cookie 转换） |
| `X-Forwarded-Proto` | `https` |
| `X-Forwarded-Host` | 原始 Host |

Portal 的 `resolveIdentity()` 信任这些头（优先路径），仅在头缺失时自验签。

---

## 12. 错误码附录

错误码定义在 `packages/contracts/src/errors.ts`，前缀 `AUTH_SSO_`：

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `VALIDATION_ERROR` | 400 | 请求参数校验失败 |
| `ENTITY_NOT_FOUND` | 404 | 请求的资源不存在 |
| `ENTITY_CONFLICT` | 409 | 唯一性冲突（如用户名已存在） |
| `BUSINESS_RULE_VIOLATION` | 422 | 业务规则违反 |
| `UNAUTHORIZED` | 401 | 未认证 |
| `FORBIDDEN` | 403 | 无权限 |
| `TOKEN_INVALID` | 401 | Token 无效 |
| `TOKEN_EXPIRED` | 401 | Token 已过期 |
| `TOKEN_REVOKED` | 401 | Token 已被撤销（jti 黑名单） |
| `ACCOUNT_LOCKED` | 423 | 账户已锁定 |
| `ACCOUNT_DISABLED` | 423 | 账户已禁用 |
| `ACCOUNT_DELETED` | 423 | 账户已注销 |
| `INVALID_GRANT` | 400 | OAuth 授权码无效/已使用 |
| `INVALID_CLIENT` | 401 | Client 认证失败 |
| `PKCE_FAILED` | 400 | PKCE 验证失败 |
| `RATE_LIMITED` | 429 | 请求频率超限 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

---

## 13. SDK 集成指南

### 13.1 OAuth 2.1 + PKCE 授权码流程

```
1. 生成 PKCE: code_verifier (随机 43-128 字符) + code_challenge = BASE64URL(SHA256(code_verifier))
2. 生成 state (随机字符串，存储于 sessionStorage)
3. 重定向用户到:
   GET /api/auth/oauth2/authorize
     ?response_type=code
     &client_id=<your_client_id>
     &redirect_uri=<your_callback_url>
     &scope=openid+profile+email
     &state=<random_state>
     &code_challenge=<code_challenge>
     &code_challenge_method=S256
4. 用户登录后，Portal 302 重定向到:
   <redirect_uri>?code=<authorization_code>&state=<state>
5. 验证 state 与第 2 步存储的一致
6. 后端用 code + code_verifier 换取 Token:
   POST /api/auth/oauth2/token
7. 解析响应中的 access_token / id_token / refresh_token
8. 用 access_token 调用 /api/auth/oauth2/userinfo 获取用户信息
```

### 13.2 JWKS 离线验证（Gateway）

```
1. 启动时拉取 /.well-known/jwks
2. 缓存公钥，按 kid 索引
3. 每个请求:
   a. 从 Cookie 提取 portal_jwt_token
   b. 解码 JWT 头部获取 kid
   c. 按 kid 查找公钥
   d. ES256 验签 + 校验 iss/exp
   e. 检查 jti 是否在 Redis 黑名单中（故障开放）
4. 验签成功后注入 Authorization: Bearer <JWT> 头
```

---

## 14. 限流策略

| 端点 | 限制 | 窗口 |
|------|------|------|
| `/api/auth/oauth2/token` | 30 次/分钟 | 60 秒滑动窗口 |
| `/api/auth/*`（认证端点） | 20 次/分钟 | 60 秒滑动窗口 |
| 其他管理 API | Portal 自身控制 | — |

限流由 Gateway 执行（Redis Lua 原子脚本），Redis 不可用时降级为进程内存滑动窗口。
