# Auth-SSO API 接口规范

**版本：** v2.1
**状态：** 正式发布
**最后更新：** 2026-07-23
**变更：** v2.1 — 权限码统一 `portal:` 前缀（ADR-008）、响应格式澄清、Gateway callback 行为更新（ADR-009）

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

Portal 存在两种不同的调用协议：

**REST HTTP 端点（route.ts）**：HTTP 状态码即成功/失败语义，响应体不额外包裹 `success` 字段。

| 场景 | HTTP 状态 | 响应体 |
|------|-----------|--------|
| 列表查询成功 | 200 | `{ "data": [...], "pagination": { "page", "pageSize", "total", "totalPages" } }` |
| 详情查询成功 | 200 | 数据对象直出（如 `{ "id": "...", "name": "..." }`） |
| 创建成功 | 201 | `{ "id": "...", "message": "..." }` |
| 操作成功 | 200 | `{ "message": "..." }` |
| 参数校验失败 | 400 | `{ "error": "VALIDATION_ERROR", "message": "..." }` |
| 未认证 | 401 | `{ "error": "AUTH_SSO_1002", "message": "..." }` |
| 无权限 | 403 | `{ "error": "AUTH_SSO_1003", "message": "..." }` |
| 资源不存在 | 404 | `{ "error": "AUTH_SSO_1004", "message": "..." }` |
| 冲突/重复 | 409 | `{ "error": "AUTH_SSO_1005", "message": "..." }` |
| 服务器错误 | 500 | `{ "error": "AUTH_SSO_1006", "message": "..." }` |

**Server Actions（RPC 调用）**：无 HTTP 协议层，通过 `success` 字段承载语义。

```json
// 成功
{ "success": true, "data": {...}, "message": "操作描述" }
// 失败
{ "success": false, "error": "AUTH_SSO_3002", "message": "错误描述" }
```

**OAuth2 端点**：遵循 RFC 6749/7662/7009 标准格式，不参与此规范。

### 1.4 分页约定

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码（从 1 开始） |
| `pageSize` | number | 20 | 每页条数 |
| `keyword` | string | — | 搜索关键词 |
| `status` | string | — | 状态过滤（ACTIVE/DISABLED/LOCKED/DELETED） |
| `deptId` | string | — | 部门过滤 |

### 1.5 REST API vs Server Action

本系统采用 Next.js App Router 架构，API 面分为两类：

| 类型 | 路径 | 用途 | 外部可调用 |
|------|------|------|-----------|
| **REST API** | `/api/*` | 查询（GET）+ 特定操作（POST/DELETE） | ✅ 是 |
| **Server Action** | 页面内表单提交 | 增删改操作 | ❌ 仅内部表单调用 |

下文中标注「🔧 Server Action」的端点不对外暴露 REST 接口，仅供 Portal 管理后台表单调用。

---

## 2. 认证 API

### 2.1 登录

```
POST /api/auth/login
```

**认证：** 无需（公开端点）

**请求体（JSON）：**
```json
{
  "email": "admin@example.com",
  "password": "SecureP@ss1",
  "session_id": "optional-oauth-session-id"
}
```
**成功响应（200）：**
```json
// OAuth 标准链路（提供了 session_id）：携带 redirect 字段，前端导航到 authorize 端点
{ "success": true, "redirect": "/api/auth/oauth2/authorize?session_id=xxx" }

// 无 OAuth 上下文（无 session_id）：仅 success:true，前端默认跳转 /dashboard
{ "success": true }
```

**说明：** 登录端点不返回 `data` 包裹——`redirect` 为可选字段（仅 OAuth 链路存在），
与 `ApiResponse<T>` 格式有所偏离，但作为内部自消费端点，保持与前端 `login-form.tsx` 的一致性是首要约束。

**错误响应（401）：**
```json
{ "success": false, "error": "INVALID_CREDENTIALS", "message": "用户名或密码错误" }
```

**约束：** 连续 5 次失败后账户锁定（LOCKED），需管理员解锁。

### 2.2 登出

```
POST /api/auth/logout
GET  /api/auth/logout
```

**认证：** Cookie `portal_jwt_token` 或 `Authorization: Bearer <JWT>`

**行为：** 清除 `portal_jwt_token` 和 `portal_refresh_token` Cookie，撤销当前 Access Token（jti 入 Redis 黑名单）。

**成功响应（200）：**
```json
{ "success": true }
```

### 2.3 Token 刷新

```
POST /api/auth/refresh
```

**认证：** Cookie `portal_refresh_token`

**优化：** 若当前 Access Token 剩余时间 > 5 分钟，跳过刷新（避免无效轮换）。

**成功响应（200）：**
```json
{
  "success": true,
  "data": { "expiresIn": 3600 }
}
```

**跳过刷新（200）：**
```json
{ "success": true, "data": { "skipped": true, "remaining": 300 } }
```

### 2.4 OAuth 回调

```
GET /api/auth/callback?code=<authorization_code>&state=<state>
```

**认证：** 无需（OAuth 2.1 Authorization Code + PKCE 流程的第二步）

**PKCE code_verifier 传递：** `code_verifier` 不通过 query 参数传递，而是由 Gateway 在 authorize 重定向时写入 `pkce_verifier` HttpOnly Cookie，callback 时从该 Cookie 读取。

**行为：** 验证 code + PKCE + state → 签发 JWT → 设置 Cookie → 重定向到 `/dashboard`。

---

## 3. OIDC Provider API

### 3.1 OIDC Discovery

```
GET /.well-known/openid-configuration
```

返回 OpenID Connect Discovery 元数据（issuer、authorization_endpoint、token_endpoint、jwks_uri 等）。

### 3.2 JWKS 公钥集

```
GET /api/auth/jwks
```

返回 ES256 公钥集（JWKS 格式），Gateway 用于离线 JWT 签名验证。

### 3.3 授权端点

```
GET /api/auth/oauth2/authorize
  ?response_type=code
  &client_id=<client_id>
  &redirect_uri=<redirect_uri>
  &scope=openid+profile+email
  &state=<random_state>
  &code_challenge=<PKCE_challenge>
  &code_challenge_method=S256
  &nonce=<random_nonce>
```

**认证：** Cookie `portal_jwt_token`（需已登录 Portal）

**行为：** 展示授权确认页 → 用户同意 → 签发授权码 → 重定向到 `redirect_uri`。

### 3.4 Token 端点

```
POST /api/auth/oauth2/token
```

**认证：** `client_id` + `client_secret`（Basic Auth 或 POST body）

**请求体（application/x-www-form-urlencoded）：**
```
grant_type=authorization_code
&code=<authorization_code>
&redirect_uri=<redirect_uri>
&code_verifier=<PKCE_verifier>
```

**成功响应（200）：**
```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "<opaque>",
  "id_token": "<jwt>",
  "scope": "openid profile email"
}
```

### 3.5 UserInfo 端点

```
GET /api/auth/oauth2/userinfo
Authorization: Bearer <access_token>
```

**认证：** Bearer Token（Access Token）

**响应（200）：**
```json
{
  "sub": "<user_id>",
  "name": "张三",
  "preferred_username": "zhangsan",
  "picture": "https://example.com/avatar.png",
  "email": "zhangsan@example.com",
  "email_verified": true
}
```

> **注意：** UserInfo 端点返回的字段由 `scopes` 参数控制（`profile` scope 返回 name/picture，`email` scope 返回 email/email_verified）。

### 3.6 Introspection 端点

```
POST /api/auth/oauth2/introspect
```

**认证：** `client_id` + `client_secret`

**请求体：**
```
token=<access_token>
&client_id=<client_id>
&client_secret=<client_secret>
```

**成功响应（200）：**
```json
{
  "active": true,
  "sub": "<user_id>",
  "client_id": "<client_id>",
  "exp": 1234567890,
  "iat": 1234567890,
  "scope": "openid profile email"
}
```

### 3.7 Revocation 端点

```
POST /api/auth/oauth2/revoke
```

**认证：** `client_id` + `client_secret`

**请求体：**
```
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

**响应（无 success 包裹）：**
```json
{
  "user": {
    "id": "<uuid>",
    "email": "admin@example.com",
    "name": "系统管理员",
    "picture": "https://example.com/avatar.png",
    "emailVerified": false
  },
  "tokenInfo": {
    "expiresAt": 1234567890000,
    "issuedAt": 1234567890000
  },
  "permissions": ["portal:user:list", "portal:user:create", "..."],
  "roles": ["SUPER_ADMIN"],
  "deptIds": ["<uuid>", "..."],
  "menus": [...]
}
```

### 4.2 获取当前用户权限

```
GET /api/me/permissions
```

**响应（无 success 包裹）：**
```json
{
  "data": {
    "userId": "<uuid>",
    "roles": ["SUPER_ADMIN"],
    "permissions": ["portal:user:list", "portal:user:create", "portal:user:read", "..."],
    "deptIds": ["<uuid>", "..."]
  }
}
```

> **注意：** 菜单数据由 DashboardLayout 客户端通过 `getUserMenus()` 函数调用获取（Server Component 级），无独立 `/api/me/menus` REST 端点。

### 4.3 自助修改个人资料（🔧 Server Action）

`updateOwnProfileAction` — 由 Portal 个人资料页（`/profile`）调用，登录用户本人即可，无需额外权限。

**可修改字段：** `name`、`email`、`avatarUrl`（不允许修改 `status` / `deptId` / 角色，防止越权）。

**目标用户锁定：** 由 `withAuth` 注入的 `ctx.userId` 决定，调用方无法指定其他用户 ID（防 IDOR）。

### 4.4 自助修改密码（🔧 Server Action）

`changeOwnPasswordAction` — 由 Portal 个人资料页调用，登录用户本人即可。

**流程：**
1. 校验 `currentPassword`（`verifyPassword` 比对 bcrypt 哈希），不匹配返回 `VALIDATION_ERROR`。
2. 校验 `newPassword` 满足密码策略（与 `CreateUserInputSchema` 一致）。
3. `hashPassword(newPassword)` 后写入 `users.passwordHash`，同时更新 `passwordChangedAt`。
4. **失效当前用户所有活跃会话**（`revokeUserAccessByUserId`），用户需用新密码重新登录（NFR-SEC-13）。

**审计：** 自动记录 `TOKEN_REVOKE` 操作（由 `withAuth` 拦截）。

---

## 5. 用户管理

**认证：** 所有端点需要 `portal_jwt_token`。数据范围受角色部门约束。

### 5.1 用户列表（REST）

```
GET /api/users?page=1&pageSize=20&keyword=张三&status=ACTIVE&deptId=<uuid>
```

**权限：** `portal:user:list`

**响应：**
```json
{
  "data": [
    {
      "id": "<uuid>",
      "username": "zhangsan",
      "email": "zhangsan@example.com",
      "name": "张三",
      "avatarUrl": null,
      "status": "ACTIVE",
      "deptId": "<uuid>",
      "deptName": "技术部",
      "createdAt": "2026-01-01T00:00:00Z",
      "lastLoginAt": null
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

### 5.2 创建用户（🔧 Server Action）

`createUserAction` — 由 Portal 创建用户表单调用，权限 `portal:user:create`。

**表单字段：** `username`、`name`、`email`、`password`、`deptId`（可选）

**约束：** 用户名和邮箱全局唯一。密码至少 8 位。

### 5.3 查看用户详情（REST）

```
GET /api/users/:id
```

**权限：** `portal:user:read`

**约束：** 只能查看数据权限范围内的用户。

### 5.4 更新用户（🔧 Server Action）

`updateUserAction` — 由 Portal 用户详情编辑表单调用，权限 `user:update`。

**可编辑字段：** `name`、`email`、`deptId`、`status`

### 5.5 切换用户状态（🔧 Server Action）

`toggleUserStatusAction` — 由 Portal 用户列表操作菜单调用，权限 `user:update`。

**行为：** ACTIVE ⇄ DISABLED 切换。

### 5.6 解锁用户（🔧 Server Action）

`unlockUserAction` — 由 Portal 调用，权限 `user:update`。

**行为：** 将 LOCKED 状态的用户恢复为 ACTIVE。

### 5.7 删除用户（🔧 Server Action）

`deleteUserAction` — 由 Portal 用户详情页调用，权限 `user:delete`。

**行为：** 软删除（设置 status=DELETED），撤销所有活跃 Token。

### 5.8 重置用户密码（REST + 🔧 Server Action）

```
POST /api/users/:id/reset-password    （REST）
```

`resetPasswordAction` — Server Action（Portal 表单调用），权限 `user:reset_password`

**请求体：**
```json
{ "password": "NewSecureP@ss1" }
```

**副作用：** 重置后当前用户所有活跃 JWT 被撤销（jti 入黑名单）。

### 5.9 管理用户角色（REST）

```
GET    /api/users/:id/roles   — 获取用户当前角色
POST   /api/users/:id/roles   — 添加角色
DELETE /api/users/:id/roles   — 移除角色
```

**权限：** `portal:user:read` (GET) / `portal:user:assign_role` (POST, DELETE)

### 5.10 强制下线用户（REST）

```
POST /api/users/:id/force-logout
```

**权限：** `portal:user:manage`

**行为：** 撤销目标用户所有活跃 Token（jti 入黑名单）。

---

## 6. 角色管理

**认证：** 所有端点需要 `portal_jwt_token`。

### 6.1 角色列表（REST）

```
GET /api/roles?page=1&pageSize=50
```

**权限：** `portal:role:list`

### 6.2 创建角色（🔧 Server Action）

`createRoleAction` — 由 Portal 创建角色弹窗调用，权限 `portal:role:create`。

### 6.3 查看角色详情（REST）

```
GET /api/roles/:id
```

**权限：** `portal:role:read`

### 6.4 更新角色（🔧 Server Action）

`updateRoleAction` — 由 Portal 角色编辑弹窗调用，权限 `portal:role:update`。

### 6.5 删除角色（🔧 Server Action）

`deleteRoleAction` — 由 Portal 调用，权限 `portal:role:delete`。

**行为：** 删除角色及其所有权限绑定。

### 6.6 角色权限（REST）

```
GET /api/roles/:id/permissions
```

**权限：** `portal:role:read`

---

## 7. 权限管理

**认证：** 所有端点需要 `portal_jwt_token`。

### 7.1 权限列表（REST）

```
GET /api/permissions?page=1&pageSize=50
```

**权限：** `portal:permission:list`

### 7.2 创建权限（🔧 Server Action）

`createPermissionAction` — 由 Portal 创建权限弹窗调用，权限 `portal:permission:create`。

### 7.3 查看权限详情（REST）

```
GET /api/permissions/:id
```

**权限：** `portal:permission:read`

### 7.4 更新权限（🔧 Server Action）

`updatePermissionAction` — 由 Portal 调用，权限 `portal:permission:update`。

### 7.5 删除权限（🔧 Server Action）

`deletePermissionAction` — 由 Portal 调用，权限 `portal:permission:delete`。

### 7.6 注册权限（REST — 系统内部）

```
POST /api/permissions/register
```

**认证：** HTTP Basic Auth（`Authorization: Basic <base64>`），仅限 `is_internal=true` 的 Client

**用途：** 批量注册/同步权限码到数据库。

---

## 8. 部门管理

**认证：** 所有端点需要 `portal_jwt_token`。

### 8.1 部门列表（REST）

```
GET /api/departments
```

**权限：** `portal:department:list`

### 8.2 创建部门（🔧 Server Action）

`createDepartmentAction` — 由 Portal 创建部门弹窗调用，权限 `portal:department:create`。

### 8.3 查看部门详情（REST）

```
GET /api/departments/:id
```

**权限：** `portal:department:read`

### 8.4 更新部门（🔧 Server Action）

`updateDepartmentAction` — 由 Portal 调用，权限 `portal:department:update`。

### 8.5 删除部门（🔧 Server Action）

`deleteDepartmentAction` — 由 Portal 调用，权限 `portal:department:delete`。

### 8.6 部门成员（REST）

```
GET /api/departments/:id/members
```

**权限：** `portal:department:read`

---

## 9. 应用管理（OAuth Clients）

**认证：** 所有端点需要 `portal_jwt_token`。

### 9.1 应用列表（REST）

```
GET /api/clients
```

**权限：** `portal:client:list`

### 9.2 创建应用（🔧 Server Action）

`createClientAction` — 由 Portal 创建应用页调用，权限 `portal:client:create`。

### 9.3 查看应用详情（REST）

```
GET /api/clients/:id
```

**权限：** `portal:client:read`

### 9.4 更新应用（🔧 Server Action）

`updateClientAction` — 由 Portal 应用详情页调用，权限 `portal:client:update`。

### 9.5 删除应用（🔧 Server Action）

`deleteClientAction` — 由 Portal 调用，权限 `portal:client:delete`。

### 9.6 轮换密钥（🔧 Server Action）

`rotateClientSecretAction` — 由 Portal 调用，权限 `portal:client:update`。

### 9.7 应用 Token 管理（REST）

```
GET    /api/clients/:id/tokens   — 查看已签发 Token
DELETE /api/clients/:id/tokens   — 撤销所有 Token
```

**权限：** `portal:client:read` / `portal:client:update`

### 9.8 撤销 Token（🔧 Server Action）

`revokeClientTokensAction` — 由 Portal 调用，权限 `portal:client:update`。

---

## 10. 审计日志 API（REST）

**认证：** 需要 `portal_jwt_token`。

### 10.1 登录日志

```
GET /api/audit/login-logs?page=1&pageSize=20
```

**权限：** `portal:audit:read`

### 10.2 操作日志

```
GET /api/audit/logs?page=1&pageSize=20
```

**权限：** `portal:audit:read`

---

## 11. Gateway 注入头

Gateway（Rust/Pingora）完成 JWT 离线验签后，向下游 Portal / 微服务注入以下身份头（三者"同生共死"：验签通过一起注入，续签成功一起覆盖）：

| Header | 值 | 说明 |
|--------|-----|------|
| `Authorization` | `Bearer <JWT>` | 原始 Access Token，供 Portal 自行解码获取完整 claims |
| `X-User-Id` | `<uuid>` | 用户 ID（取自 JWT `sub`），子系统据此查 Redis 获取权限上下文 |
| `X-User-Jti` | `<uuid>` | JWT 唯一标识（取自 JWT `jti`），用于审计与吊销追踪 |

> **注意**：用户名、邮箱、部门 ID 列表（`deptIds`）等扩展属性**不在网关注入头中**。这些数据随 Portal 登录时预热至 Redis 的 `UserPermissionContext`（Key: `sso:user_perms:{userId}`），子系统通过 `X-User-Id` 向 Redis 查询获取。详见 [`third-party-integration.md`](./third-party-integration.md)。

零信任净化：对于未通过验签的请求，网关会**强制移除**客户端可能伪造的 `Authorization`、`X-User-Id`、`X-User-Jti` 头，确保下游仅接收网关背书的身份。

---

## 12. 错误码附录

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `AUTH_SSO_2002` (INVALID_CREDENTIALS) | 401 | 用户名或密码错误 |
| `AUTH_SSO_2004` (ACCOUNT_LOCKED) | 423 | 账户已锁定（连续失败 N 次） |
| `AUTH_SSO_2003` (ACCOUNT_DISABLED) | 403 | 账户已被管理员禁用 |
| `AUTH_SSO_2020` (TOKEN_EXPIRED) | 401 | Access Token 已过期 |
| `AUTH_SSO_2025` (REFRESH_TOKEN_MISSING) | 401 | 缺少 Refresh Token Cookie |
| `AUTH_SSO_2024` (REFRESH_TOKEN_INVALID) | 401 | Refresh Token 无效或已过期 |
| `AUTH_SSO_2022` (TOKEN_REVOKED) | 401 | Token 已被撤销 |
| `AUTH_SSO_1002` (UNAUTHORIZED) | 401 | 未认证 |
| `AUTH_SSO_1003` (FORBIDDEN) | 403 | 无权限 |
| `AUTH_SSO_1004` (NOT_FOUND) | 404 | 资源不存在 |
| `AUTH_SSO_3003` (USERNAME_ALREADY_EXISTS) | 409 | 用户名已存在 |
| `AUTH_SSO_3004` (EMAIL_ALREADY_EXISTS) | 409 | 邮箱已存在 |
| `AUTH_SSO_1005` (VALIDATION_ERROR) | 400 | 参数校验失败 |
| `AUTH_SSO_1006` (INTERNAL_ERROR) | 500 | 服务器内部错误 |
| `AUTH_SSO_1007` (PAYLOAD_TOO_LARGE) | 413 | 请求体过大 |
| `AUTH_SSO_1001` (INVALID_REQUEST) | 400 | 无效请求 |

---

## 13. 子应用接入指南

### 13.1 Gateway 代理模式（推荐）

Gateway（Rust/Pingora）统一承担 OAuth 2.1 Client 角色。子应用通过 Gateway 代理后只需：

```typescript
// 1. 读取 Gateway 注入的身份头
const userId = request.headers.get('x-user-id');

// 2. 查询 Redis 获取权限上下文
const perms = await redis.get(`portal:user_perms:${userId}`);
```

不要求子应用实现 OIDC、管理 Session 或验签 JWT。详见 `docs/INTEGRATION_GUIDE.md`。

### 13.2 标准 OIDC 集成流程（适用于非 Gateway 代理的场景）

对于无法通过 Gateway 代理的第三方系统（如 SaaS 应用）：

1. 在 Portal 管理后台注册 OAuth 应用，获取 `client_id` + `client_secret`
2. 配置 Redirect URI（白名单）
3. 实现 Authorization Code + PKCE 流程
4. 使用 Token 端点换取 Access Token
5. 使用 UserInfo 端点获取用户信息
6. 定期刷新 Token（POST /api/auth/refresh 或 POST /api/auth/oauth2/token）

---

## 14. 限流策略

| 端点 | 限制 | 窗口 | 实施层 |
|------|------|------|--------|
| `POST /api/auth/login` / `POST /api/auth/refresh` | 20 次（共享计数器） | 1 分钟 | Gateway |
| `POST /api/auth/oauth2/token` | 30 次 | 1 分钟 | Gateway |
| 管理 API 写操作 | 100 次 | 1 分钟 | Portal |

> 注：login 与 refresh 在 Gateway 共享同一个 20/min 计数器（均为 `/api/auth/*` 前缀）；token 端点独立计数。Gateway 为单容器进程内限流，多实例部署时实际阈值按实例数线性放大。

超出限制返回 `429 Too Many Requests`。
