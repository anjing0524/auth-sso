# API 接口规范 - Auth-SSO

版本: v4.0
最后更新: 2026-06-24
状态: 已发布

### 0. 接入路径说明（架构约束 R10）

> **⚠️ v3.2 术语漂移**：本文档多处残留 v3.1 的旧字段名和权限码。实际代码以 `apps/portal/src/` 为准。已知差异：
> - `dataScopeType` → 已移除，响应中不再返回
> - `user:reset_password` → `user:update`
> - `login_log:read` → `audit:read`
> - `permission:manage` → `permissions/register` 使用 Basic Auth（client_id+secret）
> - `introspect` / `revoke` 端点需 client 认证
> - 写端点文档声明 `x-www-form-urlencoded`，代码只接受 JSON

---

## 1. 全局约定

### 1.1 基础 URL
- **Portal API（含 OIDC Provider）**: `https://portal.example.com/api`

### 1.2 通用响应格式

> **v4.0 更新**：实际实现使用两种响应格式，详见下文。

**Server Action 成功**:
```json
{ "success": true, "data": {}, "message": "操作成功" }
```

**Server Action 失败**:
```json
{ "success": false, "error": "VALIDATION_ERROR", "message": "错误描述" }
```

**API Route 成功**:
```json
{ "data": {} }
```

**API Route 鉴权失败**:
```json
{ "error": "AUTH_SSO_1003", "message": "权限不足" }
```

**OAuth 端点错误 (RFC 6749)**:
```json
{ "error": "invalid_grant", "error_description": "授权码已被使用" }
```

### 1.3 通用错误码
- `BAD_REQUEST`: 参数校验失败。
- `UNAUTHORIZED`: JWT Cookie 无效或缺失。
- `FORBIDDEN`: 权限不足。
- `NOT_FOUND`: 资源不存在。
- `INTERNAL_ERROR`: 服务器内部错误。

### 1.4 ID 约定
- **公开 ID**: 所有 API 中暴露的 ID（路径参数、请求体、响应）均为字符串类型（`public_id`），例如 `u_abc123`。
- **内部 ID**: 数据库主键同样使用字符串（UUID），以确保各环境一致性。
- **不透明性**: 前端和外部消费者不直接操作数据库内部主键。

### 1.5 认证约定
所有管理后台 API 端点均要求提供有效的 `portal_jwt_token` HttpOnly Cookie。该 Cookie 由 Portal BFF 在 OAuth 回调流程中设置。JWT 中包含用户身份、角色、权限和数据范围声明。每个 API 路由处理器通过 `withPermission()` 包装器进行详细的权限校验。

### 1.6 分页约定
所有列表类 API 端点遵循统一的分页契约。

**请求参数**（查询字符串）：

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `page` | integer | `1` | 页码（从 1 开始） |
| `pageSize` | integer | `20` | 每页条数（最大 100） |

**响应格式**：
```json
{
  "data": [
    { "...": "..." }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

**请求示例**：
```bash
curl -X GET 'https://portal.example.com/api/users?page=2&pageSize=10' \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

### 1.7 数据范围过滤
所有管理后台列表类 API 的响应会根据当前用户的 DataScope 自动进行过滤。过滤对调用方透明——同一端点根据调用者的权限返回不同的结果。

| DataScope 类型 | 说明 |
|----------------|-------------|
| `ALL` | 返回整个组织内的所有数据 |
| `DEPT` | 仅返回当前用户所属部门的数据 |
| `DEPT_AND_SUB` | 返回当前用户所属部门及所有子部门的数据 |
| `SELF` | 仅返回与当前用户直接相关的数据 |
| `CUSTOM` | 返回与用户角色明确关联的特定部门数据 |

DataScope 在角色级别分配，并由该角色的所有用户继承。如果用户拥有多个角色，则以权限最大的范围为准。

### 1.8 速率限制
API 端点按 IP 地址进行速率限制。

| 范围 | 限制 | 窗口 |
|-------|-------|--------|
| 通用 API | 60 次请求 | 1 分钟（滑动窗口） |
| 认证（`/api/auth/*`） | 20 次请求 | 1 分钟（滑动窗口） |
| OIDC Token（`/api/auth/oauth2/token`） | 30 次请求 | 1 分钟（滑动窗口） |

达到速率限制时，API 将返回：

```json
{
  "code": "RATE_LIMITED",
  "message": "请求过于频繁，请稍后再试",
  "requestId": "req_abc123"
}
```

状态码: `429 Too Many Requests`

---

## 2. 认证 API（Portal）

### 2.1 `GET /api/me`
获取当前登录用户的个人信息、权限和菜单列表。

**认证方式**: 需要 `portal_jwt_token` HttpOnly Cookie。

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/me \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -H 'Accept: application/json'
```

#### 成功响应 (200)
```json
{
  "authenticated": true,
  "user": {
    "id": "u_1",
    "name": "John Doe",
    "email": "admin@example.com",
    "avatar": null,
    "deptId": "d_1",
    "deptName": "Engineering",
    "roles": ["super_admin"],
    "permissions": ["user:list", "user:create", "role:list", "role:assign_permission", "client:list", "audit:read"],
    "dataScopeType": "ALL"
  },
  "menus": [
    { "name": "User Management", "path": "/admin/users", "icon": "Users" },
    { "name": "Role Management", "path": "/admin/roles", "icon": "Shield" },
    { "name": "Permission Management", "path": "/admin/permissions", "icon": "Key" },
    { "name": "Department Management", "path": "/admin/departments", "icon": "Building2" },
    { "name": "Client Management", "path": "/admin/clients", "icon": "Monitor" },
    { "name": "Audit Logs", "path": "/admin/audit-logs", "icon": "FileText" }
  ]
}
```

#### 错误响应 (401) -- 未登录或 Token 过期
```json
{
  "code": "UNAUTHORIZED",
  "message": "未登录或 token 已过期，请重新登录",
  "requestId": "req_abc123"
}
```

---

### 2.2 `POST /api/auth/login`
初始化登录流程。验证用户凭据，签发一个临时的 `login_session` JWT（5 分钟 TTL，ES256 算法），并将其设置为 HttpOnly Cookie 供 authorize 端点使用。

**请求体**：
```json
{
  "email": "user@example.com",
  "password": "user_password"
}
```

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"email":"admin@example.com","password":"Admin123!"}'
```

#### 成功响应 (200)
```json
{
  "success": true
}
```
Set-Cookie 响应头将包含 `login_session`（path=/api/auth/oauth2/authorize）。

#### 错误响应 (400) -- 参数校验失败
```json
{
  "code": "BAD_REQUEST",
  "message": "邮箱格式不正确",
  "requestId": "req_abc123"
}
```

#### 错误响应 (401) -- 凭据无效
```json
{
  "code": "INVALID_CREDENTIALS",
  "message": "邮箱或密码错误",
  "requestId": "req_abc123"
}
```

#### 错误响应 (403) -- 账户被禁用
```json
{
  "code": "ACCOUNT_DISABLED",
  "message": "账户已被禁用，请联系管理员",
  "requestId": "req_abc123"
}
```

> **安全性说明**：为防用户枚举攻击，账户不存在与密码错误均返回 `INVALID_CREDENTIALS`，不区分具体原因。连续 5 次登录失败将临时锁定账户 15 分钟。

---

### 2.3 `POST /api/auth/logout`
登出并废弃当前会话：
1. 解码当前 `portal_jwt_token`，将其 `jti` 加入 Redis 黑名单（立即撤销）。
2. 清除 `portal_jwt_token` Cookie。

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/auth/logout \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -H 'Accept: application/json'
```

#### 成功响应 (200)
```json
{
  "success": true
}
```
Set-Cookie 响应头将清除 `portal_jwt_token`（maxAge=0）和 `portal_refresh_token`（maxAge=0）。

> **注意**：登出是幂等的。即使未登录或 Token 已过期，调用此端点仍返回 200 并清除所有 Cookie。

---

### 2.4 `POST /api/auth/refresh`
使用 `portal_refresh_token` Cookie（Refresh Token Rotation）静默刷新 `portal_jwt_token` HttpOnly Cookie。

**请求**：
- 包含 `portal_refresh_token`（Path=/api/auth/refresh）的 Cookie。

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/auth/refresh \
  --cookie 'portal_refresh_token=rt_v2_abc123def456' \
  -H 'Accept: application/json'
```

#### 成功响应 (200)
```json
{
  "success": true,
  "data": {
    "expiresIn": 3600
  }
}
```
Set-Cookie 响应头将包含更新后的 `portal_jwt_token` 和 `portal_refresh_token`。

#### 错误响应 (401) -- Refresh Token 过期或无效
```json
{
  "code": "UNAUTHORIZED",
  "message": "登录已过期，请重新登录",
  "requestId": "req_abc123"
}
```

> **安全性说明**：Refresh Token Rotation 意味着每次刷新后旧的 Refresh Token 立即失效。如果检测到重复使用已作废的 Refresh Token（可能被盗用），所有关联的 Refresh Token 将被全部撤销。

---

### 2.5 `GET /api/me/permissions`
获取当前用户的详细权限上下文，包括所有已分配的权限代码和有效的数据范围。

**认证方式**: 需要 `portal_jwt_token` HttpOnly Cookie。

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/me/permissions \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "userId": "u_1",
  "roles": ["super_admin"],
  "permissions": ["user:list", "user:create", "user:read", "user:update", "user:delete", "user:reset_password"],
  "dataScopeType": "ALL",
  "deptId": "d_1",
  "customDeptIds": []
}
```

---

## 3. 管理后台 API（Portal）

需要 `portal_jwt_token` HttpOnly Cookie 和相应的权限代码。所有路由均通过 `withPermission()` 中间件包装器进行保护。

### 3.1 用户管理

#### `GET /api/users` -- 用户列表（分页）

**所需权限**: `user:list`

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `page` | integer | 否 | 页码（默认值：1） |
| `pageSize` | integer | 否 | 每页条数（默认值：20，最大：100） |
| `keyword` | string | 否 | 按姓名或邮箱搜索（模糊匹配） |
| `status` | string | 否 | 按状态筛选：`active`、`disabled` |
| `deptId` | string | 否 | 按部门 ID 筛选 |

**数据范围**: 结果根据当前用户的数据范围（ALL、DEPT、DEPT_AND_SUB、SELF、CUSTOM）自动过滤。

#### curl 示例
```bash
curl -X GET 'https://portal.example.com/api/users?page=1&pageSize=20&keyword=john&deptId=d_1' \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "data": [
    {
      "id": "u_1",
      "name": "John Doe",
      "email": "john@example.com",
      "status": "active",
      "deptId": "d_1",
      "deptName": "Engineering",
      "roles": ["developer"],
      "createdAt": "2026-01-15T08:30:00Z",
      "updatedAt": "2026-06-20T14:22:00Z"
    },
    {
      "id": "u_2",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "status": "active",
      "deptId": "d_2",
      "deptName": "Marketing",
      "roles": ["viewer"],
      "createdAt": "2026-02-10T10:00:00Z",
      "updatedAt": "2026-06-18T09:15:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 2,
    "totalPages": 1
  }
}
```

---

#### `POST /api/users` -- 创建用户

**所需权限**: `user:create`

**请求体**：
```json
{
  "name": "Alice Wang",
  "email": "alice@example.com",
  "password": "TempPass123!",
  "deptId": "d_1",
  "status": "active",
  "roleIds": ["r_1", "r_2"]
}
```

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/users \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmNyZWF0ZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"name":"Alice Wang","email":"alice@example.com","password":"TempPass123!","deptId":"d_1","status":"active","roleIds":["r_1","r_2"]}'
```

#### 成功响应 (201)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "u_3",
    "name": "Alice Wang",
    "email": "alice@example.com",
    "status": "active",
    "deptId": "d_1",
    "createdAt": "2026-06-24T10:00:00Z"
  }
}
```

#### 错误响应 (409) -- 邮箱已存在
```json
{
  "code": "USER_ALREADY_EXISTS",
  "message": "该邮箱已被其他账户使用",
  "requestId": "req_abc123"
}
```

---

#### `GET /api/users/:id` -- 获取用户详情

**所需权限**: `user:read`

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/users/u_1 \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOnJlYWQiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "u_1",
    "name": "John Doe",
    "email": "john@example.com",
    "status": "active",
    "deptId": "d_1",
    "deptName": "Engineering",
    "roles": [
      { "id": "r_1", "name": "Developer", "code": "developer" }
    ],
    "createdAt": "2026-01-15T08:30:00Z",
    "updatedAt": "2026-06-20T14:22:00Z"
  }
}
```

#### 错误响应 (404) -- 用户不存在
```json
{
  "code": "USER_NOT_FOUND",
  "message": "用户不存在",
  "requestId": "req_abc123"
}
```

---

#### `PUT /api/users/:id` -- 更新用户信息

**所需权限**: `user:update`

**请求体**（所有字段均可选）：
```json
{
  "name": "John Doe Updated",
  "email": "john.new@example.com",
  "deptId": "d_2",
  "status": "disabled"
}
```

#### curl 示例
```bash
curl -X PUT https://portal.example.com/api/users/u_1 \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOnVwZGF0ZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"name":"John Doe Updated","deptId":"d_2"}'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "u_1",
    "name": "John Doe Updated",
    "email": "john@example.com",
    "deptId": "d_2"
  }
}
```

---

#### `DELETE /api/users/:id` -- 删除用户

**所需权限**: `user:delete`

#### curl 示例
```bash
curl -X DELETE https://portal.example.com/api/users/u_3 \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmRlbGV0ZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success"
}
```

> **注意**：无法删除当前登录用户自身。删除操作是物理删除，不可恢复。

---

#### `POST /api/users/:id/reset-password` -- 重置用户密码

**所需权限**: `user:reset_password`

**请求体**：
```json
{
  "newPassword": "NewPass456!"
}
```

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/users/u_1/reset-password \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOnJlc2V0X3Bhc3N3b3JkIl0sImRhdGFTY29wZVR5cGUiOiJBTEwiLCJqdGkiOiJqdGlfMTIzIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"newPassword":"NewPass456!"}'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "密码重置成功"
}
```

---

#### `POST /api/users/:id/roles` -- 为用户分配角色

**所需权限**: `user:assign_role`

**请求体**：
```json
{
  "roleIds": ["r_1", "r_3"]
}
```

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/users/u_1/roles \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmFzc2lnbl9yb2xlIl0sImRhdGFTY29wZVR5cGUiOiJBTEwiLCJqdGkiOiJqdGlfMTIzIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"roleIds":["r_1","r_3"]}'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success"
}
```

---

#### `POST /api/users/:id/force-logout` -- 强制用户登出

**所需权限**: `user:manage`

该端点通过将用户的 JWT `jti` 加入 Redis 黑名单并删除其所有 refresh token，来撤销指定用户的所有活跃会话。

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/users/u_2/force-logout \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOm1hbmFnZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "该用户已被强制登出"
}
```

---

### 3.2 部门管理

#### `GET /api/departments` -- 部门列表（树形结构）

**所需权限**: `department:list`

返回部门列表，支持扁平列表（包含 `parentId` 引用，供客户端自行构建树形结构）或嵌套树形结构。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `tree` | boolean | 否 | 若为 `true`，返回嵌套树形结构（默认值：`false`） |

#### curl 示例
```bash
curl -X GET 'https://portal.example.com/api/departments?tree=true' \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJkZXBhcnRtZW50Omxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": [
    {
      "id": "d_1",
      "name": "Headquarters",
      "parentId": null,
      "sortOrder": 1,
      "children": [
        {
          "id": "d_2",
          "name": "Engineering",
          "parentId": "d_1",
          "sortOrder": 1,
          "children": [
            {
              "id": "d_3",
              "name": "Frontend Team",
              "parentId": "d_2",
              "sortOrder": 1,
              "children": []
            },
            {
              "id": "d_4",
              "name": "Backend Team",
              "parentId": "d_2",
              "sortOrder": 2,
              "children": []
            }
          ]
        },
        {
          "id": "d_5",
          "name": "Marketing",
          "parentId": "d_1",
          "sortOrder": 2,
          "children": []
        }
      ]
    }
  ]
}
```

---

#### `POST /api/departments` -- 创建新部门

**所需权限**: `department:create`

**请求体**：
```json
{
  "name": "QA Team",
  "parentId": "d_2",
  "sortOrder": 3
}
```

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/departments \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJkZXBhcnRtZW50OmNyZWF0ZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"name":"QA Team","parentId":"d_2","sortOrder":3}'
```

#### 成功响应 (201)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "d_6",
    "name": "QA Team",
    "parentId": "d_2",
    "sortOrder": 3
  }
}
```

#### 错误响应 (400) -- 父部门不存在
```json
{
  "code": "DEPARTMENT_NOT_FOUND",
  "message": "父部门不存在",
  "requestId": "req_abc123"
}
```

---

#### `GET /api/departments/:id` -- 获取部门详情

**所需权限**: `department:read`

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/departments/d_2 \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJkZXBhcnRtZW50OnJlYWQiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "d_2",
    "name": "Engineering",
    "parentId": "d_1",
    "parentName": "Headquarters",
    "sortOrder": 1,
    "memberCount": 15,
    "createdAt": "2026-01-01T00:00:00Z"
  }
}
```

---

#### `PUT /api/departments/:id` -- 更新部门信息

**所需权限**: `department:update`

**请求体**：
```json
{
  "name": "Engineering Department",
  "parentId": "d_1",
  "sortOrder": 1
}
```

#### curl 示例
```bash
curl -X PUT https://portal.example.com/api/departments/d_2 \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJkZXBhcnRtZW50OnVwZGF0ZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"name":"Engineering Department"}'
```

> **注意**：修改 `parentId` 时会进行循环引用检测。如果将部门父级设为自己的子级，将返回 400 错误。

---

#### `DELETE /api/departments/:id` -- 删除部门

**所需权限**: `department:delete`

#### curl 示例
```bash
curl -X DELETE https://portal.example.com/api/departments/d_6 \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJkZXBhcnRtZW50OmRlbGV0ZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 错误响应 (400) -- 部门下有子部门或成员
```json
{
  "code": "DEPARTMENT_HAS_CHILDREN",
  "message": "该部门下存在子部门，无法删除",
  "requestId": "req_abc123"
}
```

---

#### `GET /api/departments/:id/members` -- 列出部门成员

**所需权限**: `department:read`

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `page` | integer | 否 | 页码（默认值：1） |
| `pageSize` | integer | 否 | 每页条数（默认值：20） |
| `includeSub` | boolean | 否 | 是否包含子部门成员（默认值：`false`） |

#### curl 示例
```bash
curl -X GET 'https://portal.example.com/api/departments/d_2/members?page=1&pageSize=10' \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJkZXBhcnRtZW50OnJlYWQiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "data": [
    {
      "id": "u_1",
      "name": "John Doe",
      "email": "john@example.com",
      "roleNames": ["Developer"]
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

---

### 3.3 角色管理

#### `GET /api/roles` -- 角色列表

**所需权限**: `role:list`

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `page` | integer | 否 | 页码（默认值：1） |
| `pageSize` | integer | 否 | 每页条数（默认值：20） |
| `keyword` | string | 否 | 按角色名称或编码搜索 |

#### curl 示例
```bash
curl -X GET 'https://portal.example.com/api/roles?page=1&pageSize=20' \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "data": [
    {
      "id": "r_1",
      "name": "Super Admin",
      "code": "super_admin",
      "description": "Full system access",
      "dataScopeType": "ALL",
      "isSystem": true,
      "userCount": 3,
      "createdAt": "2026-01-01T00:00:00Z"
    },
    {
      "id": "r_2",
      "name": "Developer",
      "code": "developer",
      "description": "Developer role with read/write access to engineering resources",
      "dataScopeType": "DEPT_AND_SUB",
      "isSystem": false,
      "userCount": 12,
      "createdAt": "2026-01-15T09:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 2,
    "totalPages": 1
  }
}
```

---

#### `POST /api/roles` -- 创建角色（包含权限 ID 和数据范围）

**所需权限**: `role:create`

**请求体**：
```json
{
  "name": "Auditor",
  "code": "auditor",
  "description": "Read-only access to audit logs",
  "dataScopeType": "ALL",
  "permissionIds": ["p_audit_read", "p_login_log_read"]
}
```

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/roles \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJyb2xlOmNyZWF0ZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"name":"Auditor","code":"auditor","description":"Read-only access to audit logs","dataScopeType":"ALL","permissionIds":["p_audit_read","p_login_log_read"]}'
```

#### 成功响应 (201)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "r_3",
    "name": "Auditor",
    "code": "auditor",
    "dataScopeType": "ALL"
  }
}
```

---

#### `GET /api/roles/:id` -- 获取角色详情

**所需权限**: `role:read`

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/roles/r_1 \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJyb2xlOnJlYWQiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "r_1",
    "name": "Super Admin",
    "code": "super_admin",
    "description": "Full system access",
    "dataScopeType": "ALL",
    "isSystem": true,
    "permissions": [
      { "id": "p_user_list", "code": "user:list", "name": "List Users" },
      { "id": "p_user_create", "code": "user:create", "name": "Create Users" }
    ],
    "userCount": 3,
    "createdAt": "2026-01-01T00:00:00Z"
  }
}
```

---

#### `PUT /api/roles/:id` -- 更新角色信息

**所需权限**: `role:update`

**请求体**：
```json
{
  "name": "Senior Developer",
  "description": "Developer role with extended permissions",
  "dataScopeType": "ALL"
}
```

#### curl 示例
```bash
curl -X PUT https://portal.example.com/api/roles/r_2 \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJyb2xlOnVwZGF0ZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"name":"Senior Developer","dataScopeType":"ALL"}'
```

> **注意**：系统内置角色（`isSystem: true`）无法被删除或修改 `code`。

---

#### `DELETE /api/roles/:id` -- 删除角色

**所需权限**: `role:delete`

#### curl 示例
```bash
curl -X DELETE https://portal.example.com/api/roles/r_3 \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJyb2xlOmRlbGV0ZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 错误响应 (400) -- 角色下有用户
```json
{
  "code": "ROLE_HAS_USERS",
  "message": "该角色下存在用户，无法删除",
  "requestId": "req_abc123"
}
```

---

#### `GET /api/roles/:id/permissions` -- 获取角色已分配的权限

**所需权限**: `role:read`

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/roles/r_1/permissions \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJyb2xlOnJlYWQiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": [
    { "id": "p_user_list", "code": "user:list", "name": "List Users", "group": "USER" },
    { "id": "p_user_create", "code": "user:create", "name": "Create Users", "group": "USER" },
    { "id": "p_role_list", "code": "role:list", "name": "List Roles", "group": "ROLE" }
  ]
}
```

---

#### `PUT /api/roles/:id/permissions` -- 更新角色分配的权限

**所需权限**: `role:assign_permission`

**请求体**：
```json
{
  "permissionIds": ["p_user_list", "p_user_read", "p_role_list"]
}
```

#### curl 示例
```bash
curl -X PUT https://portal.example.com/api/roles/r_2/permissions \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJyb2xlOmFzc2lnbl9wZXJtaXNzaW9uIl0sImRhdGFTY29wZVR5cGUiOiJBTEwiLCJqdGkiOiJqdGlfMTIzIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"permissionIds":["p_user_list","p_user_read","p_role_list"]}'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success"
}
```

---

#### `GET /api/roles/:id/clients` -- 获取角色关联的 OAuth 客户端

**所需权限**: `role:read`

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/roles/r_1/clients \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJyb2xlOnJlYWQiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": [
    {
      "id": "c_1",
      "name": "Web Application",
      "clientId": "client_web_app"
    }
  ]
}
```

> **v3.2 废弃**：`GET/PUT /api/roles/:id/data-scopes` 端点已移除。角色数据范围现由 `roles.dept_id` 隐式决定（含子部门），不再需要独立的 data-scopes 绑定。详见 `RBAC_MODEL_REDESIGN.md`。

---

### 3.4 权限管理

#### `GET /api/permissions` -- 列出所有可用权限代码

**所需权限**: `permission:list`

返回系统中所有已注册的权限，按资源分组组织。

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/permissions \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJwZXJtaXNzaW9uOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": [
    {
      "id": "p_user_list",
      "code": "user:list",
      "name": "List Users",
      "group": "USER",
      "description": "View the list of all users"
    },
    {
      "id": "p_user_create",
      "code": "user:create",
      "name": "Create Users",
      "group": "USER",
      "description": "Create new user accounts"
    },
    {
      "id": "p_role_assign_permission",
      "code": "role:assign_permission",
      "name": "Assign Permissions",
      "group": "ROLE",
      "description": "Assign permissions to roles"
    },
    {
      "id": "p_client_rotate_secret",
      "code": "client:rotate_secret",
      "name": "Rotate Client Secret",
      "group": "CLIENT",
      "description": "Generate new OAuth client secret"
    },
    {
      "id": "p_audit_read",
      "code": "audit:read",
      "name": "Read Audit Logs",
      "group": "AUDIT",
      "description": "View audit log entries"
    }
  ]
}
```

**可用权限代码完整列表**：

| 资源组 | 权限代码 |
|----------------|-----------------|
| **USER** | `user:list`, `user:create`, `user:read`, `user:update`, `user:delete`, `user:manage`, `user:reset_password`, `user:assign_role` |
| **DEPARTMENT** | `department:list`, `department:create`, `department:read`, `department:update`, `department:delete`, `department:manage` |
| **ROLE** | `role:list`, `role:create`, `role:read`, `role:update`, `role:delete`, `role:manage`, `role:assign_permission` |
| **PERMISSION** | `permission:list`, `permission:create`, `permission:read`, `permission:update`, `permission:delete`, `permission:manage` |
| **MENU** | `menu:list`, `menu:create`, `menu:read`, `menu:update`, `menu:delete`, `menu:manage` |
| **CLIENT** | `client:list`, `client:create`, `client:read`, `client:update`, `client:delete`, `client:manage`, `client:rotate_secret` |
| **AUDIT** | `audit:read`, `audit:export` |
| **LOGIN_LOG** | `login_log:read`, `login_log:export` |
| **SYSTEM** | `system:manage`, `system:view_dashboard` |
| **CUSTOMER_GRAPH** | `customer_graph:view`, `customer_graph:export` |

---

#### `GET /api/permissions/:id` -- 获取权限详情

**所需权限**: `permission:read`

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/permissions/p_user_list \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJwZXJtaXNzaW9uOnJlYWQiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV8xMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "p_user_list",
    "code": "user:list",
    "name": "List Users",
    "group": "USER",
    "description": "View the list of all users"
  }
}
```

---

#### `POST /api/permissions/register` -- 批量注册新权限

**所需权限**: `permission:manage`

在系统中注册新的权限代码。用于初始设置和添加自定义权限。

**请求体**：
```json
{
  "permissions": [
    {
      "code": "report:view",
      "name": "View Reports",
      "group": "REPORT",
      "description": "Access the reporting dashboard"
    },
    {
      "code": "report:export",
      "name": "Export Reports",
      "group": "REPORT",
      "description": "Export report data"
    }
  ]
}
```

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/permissions/register \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJwZXJtaXNzaW9uOm1hbmFnZSJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"permissions":[{"code":"report:view","name":"View Reports","group":"REPORT","description":"Access the reporting dashboard"},{"code":"report:export","name":"Export Reports","group":"REPORT","description":"Export report data"}]}'
```

#### 成功响应 (201)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "registered": 2,
    "skipped": 0
  }
}
```

---

### 3.5 OAuth 客户端管理

#### `GET /api/clients` -- OAuth 客户端列表

**所需权限**: `client:list`

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `page` | integer | 否 | 页码（默认值：1） |
| `pageSize` | integer | 否 | 每页条数（默认值：20） |

#### curl 示例
```bash
curl -X GET 'https://portal.example.com/api/clients?page=1&pageSize=20' \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJjbGllbnQ6bGlzdCJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "data": [
    {
      "id": "c_1",
      "name": "Web Application",
      "clientId": "client_web_app",
      "redirectUris": ["https://app.example.com/callback"],
      "grantTypes": ["authorization_code", "refresh_token"],
      "requirePkce": true,
      "status": "active",
      "createdAt": "2026-01-10T08:00:00Z"
    },
    {
      "id": "c_2",
      "name": "Mobile App",
      "clientId": "client_mobile_app",
      "redirectUris": ["myapp://callback", "https://mobile.example.com/callback"],
      "grantTypes": ["authorization_code", "refresh_token"],
      "requirePkce": true,
      "status": "active",
      "createdAt": "2026-02-20T12:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 2,
    "totalPages": 1
  }
}
```

---

#### `POST /api/clients` -- 注册新的 OAuth 客户端

**所需权限**: `client:create`

**请求体**：
```json
{
  "name": "New SPA Application",
  "redirectUris": ["https://spa.example.com/auth/callback"],
  "grantTypes": ["authorization_code", "refresh_token"],
  "requirePkce": true,
  "logoUri": "https://spa.example.com/logo.png"
}
```

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/clients \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJjbGllbnQ6Y3JlYXRlIl0sImRhdGFTY29wZVR5cGUiOiJBTEwiLCJqdGkiOiJqdGlfMTIzIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"name":"New SPA Application","redirectUris":["https://spa.example.com/auth/callback"],"grantTypes":["authorization_code","refresh_token"],"requirePkce":true}'
```

#### 成功响应 (201)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "c_3",
    "name": "New SPA Application",
    "clientId": "client_spa_app",
    "clientSecret": "sk_live_abc123def456xyz789",
    "redirectUris": ["https://spa.example.com/auth/callback"],
    "grantTypes": ["authorization_code", "refresh_token"],
    "requirePkce": true,
    "status": "active"
  }
}
```

> **安全性说明**：`clientSecret` 仅在创建时返回一次，后续无法再次读取。如果遗失，请使用 `POST /api/clients/:id/rotate-secret` 生成新密钥。

---

#### `GET /api/clients/:id` -- 获取客户端详情

**所需权限**: `client:read`

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/clients/c_1 \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJjbGllbnQ6cmVhZCJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "c_1",
    "name": "Web Application",
    "clientId": "client_web_app",
    "redirectUris": ["https://app.example.com/callback"],
    "grantTypes": ["authorization_code", "refresh_token"],
    "requirePkce": true,
    "status": "active",
    "createdAt": "2026-01-10T08:00:00Z",
    "updatedAt": "2026-06-01T10:30:00Z"
  }
}
```

---

#### `PUT /api/clients/:id` -- 更新客户端设置

**所需权限**: `client:update`

**请求体**（所有字段均可选）：
```json
{
  "name": "Web Application v2",
  "redirectUris": ["https://app-v2.example.com/callback"],
  "status": "active"
}
```

#### curl 示例
```bash
curl -X PUT https://portal.example.com/api/clients/c_1 \
  -H "Content-Type: application/json" \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJjbGllbnQ6dXBkYXRlIl0sImRhdGFTY29wZVR5cGUiOiJBTEwiLCJqdGkiOiJqdGlfMTIzIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d '{"name":"Web Application v2","redirectUris":["https://app-v2.example.com/callback"]}'
```

---

#### `DELETE /api/clients/:id` -- 删除客户端

**所需权限**: `client:delete`

#### curl 示例
```bash
curl -X DELETE https://portal.example.com/api/clients/c_3 \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJjbGllbnQ6ZGVsZXRlIl0sImRhdGFTY29wZVR5cGUiOiJBTEwiLCJqdGkiOiJqdGlfMTIzIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

---

#### `POST /api/clients/:id/rotate-secret` -- 生成新的客户端密钥

**所需权限**: `client:rotate_secret`

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/clients/c_1/rotate-secret \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJjbGllbnQ6cm90YXRlX3NlY3JldCJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "clientSecret": "sk_live_xyz789abc456"
  }
}
```

> **安全性说明**：旋转密钥会立即使旧密钥失效。所有使用旧密钥进行 OIDC Token Exchange 的请求将立即失败。

---

#### `GET /api/clients/:id/tokens` -- 列出客户端的活跃令牌

**所需权限**: `client:read`

返回有关为该客户端签发的活跃 refresh token 的信息。

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/clients/c_1/tokens \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJjbGllbnQ6cmVhZCJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "data": [
    {
      "id": "rt_v2_abc123",
      "userId": "u_1",
      "userName": "John Doe",
      "createdAt": "2026-06-20T14:22:00Z",
      "expiresAt": "2026-06-27T14:22:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

---

#### `DELETE /api/clients/:id/tokens` -- 撤销客户端的所有令牌

**所需权限**: `client:manage`

撤销为该客户端签发的所有活跃 refresh token。在客户端被攻陷时使用。

#### curl 示例
```bash
curl -X DELETE https://portal.example.com/api/clients/c_1/tokens \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJjbGllbnQ6bWFuYWdlIl0sImRhdGFTY29wZVR5cGUiOiJBTEwiLCJqdGkiOiJqdGlfMTIzIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "code": "OK",
  "message": "success"
}
```

---

### 3.6 菜单管理

菜单管理通过管理后台 UI 进行操作。当前用户可访问的菜单通过 `GET /api/me` 端点获取。菜单配置由服务端操作管理，不对外暴露 REST API。

菜单的 CRUD 操作请参考管理后台 UI（可通过 `/admin/menus` 访问）。

---

### 3.7 审计日志

#### `GET /api/audit/logs` -- 查询审计日志

**所需权限**: `audit:read`

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `page` | integer | 否 | 页码（默认值：1） |
| `pageSize` | integer | 否 | 每页条数（默认值：20，最大：100） |
| `userId` | string | 否 | 按用户 ID 筛选 |
| `operation` | string | 否 | 按操作类型筛选 |
| `startDate` | string (ISO 8601) | 否 | 筛选此日期之后的日志 |
| `endDate` | string (ISO 8601) | 否 | 筛选此日期之前的日志 |

**支持的操作类型**：`LOGIN`, `LOGOUT`, `TOKEN_REFRESH`, `CREATE_USER`, `UPDATE_USER`, `DELETE_USER`, `CREATE_ROLE`, `UPDATE_ROLE`, `DELETE_ROLE`, `ASSIGN_PERMISSION`, `CREATE_CLIENT`, `UPDATE_CLIENT`, `DELETE_CLIENT`, `ROTATE_SECRET`, `CREATE_DEPT`, `UPDATE_DEPT`, `DELETE_DEPT`, `FORCE_LOGOUT`, `PASSWORD_RESET`。

#### curl 示例
```bash
curl -X GET 'https://portal.example.com/api/audit/logs?page=1&pageSize=10&operation=CREATE_USER&startDate=2026-06-01T00:00:00Z' \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJhdWRpdDpyZWFkIl0sImRhdGFTY29wZVR5cGUiOiJBTEwiLCJqdGkiOiJqdGlfMTIzIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "data": [
    {
      "id": "log_1",
      "userId": "u_1",
      "userName": "John Doe",
      "operation": "CREATE_USER",
      "targetId": "u_3",
      "targetName": "Alice Wang",
      "details": "Created user Alice Wang with roles [developer]",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0 ...",
      "createdAt": "2026-06-24T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

---

#### `GET /api/audit/login-logs` -- 查询登录日志

**所需权限**: `login_log:read`

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `page` | integer | 否 | 页码（默认值：1） |
| `pageSize` | integer | 否 | 每页条数（默认值：20） |
| `userId` | string | 否 | 按用户 ID 筛选 |
| `status` | string | 否 | 按状态筛选：`SUCCESS`、`FAILED` |
| `startDate` | string (ISO 8601) | 否 | 筛选此日期之后的日志 |
| `endDate` | string (ISO 8601) | 否 | 筛选此日期之前的日志 |

#### curl 示例
```bash
curl -X GET 'https://portal.example.com/api/audit/login-logs?page=1&pageSize=20&status=FAILED' \
  --cookie 'portal_jwt_token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJsb2dpbl9sb2c6cmVhZCJdLCJkYXRhU2NvcGVUeXBlIjoiQUxMIiwianRpIjoianRpXzEyMyIsImlhdCI6MTcxNzc5ODAwMCwiZXhwIjoxNzE3ODAxNjAwfQ.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (200)
```json
{
  "data": [
    {
      "id": "ll_1",
      "userId": "u_1",
      "userName": "John Doe",
      "email": "john@example.com",
      "status": "SUCCESS",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0 ...",
      "loginAt": "2026-06-24T09:00:00Z"
    },
    {
      "id": "ll_2",
      "userId": null,
      "userName": null,
      "email": "unknown@example.com",
      "status": "FAILED",
      "failureReason": "INVALID_CREDENTIALS",
      "ipAddress": "203.0.113.50",
      "loginAt": "2026-06-24T08:55:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 2,
    "totalPages": 1
  }
}
```

---

## 4. OIDC Provider API（内建于 Portal）

标准 OAuth 2.1 和 OIDC 端点，以 Next.js Route Handler 方式自定义实现：

| 端点 | 路径 | 方法 | 说明 |
|--------|------|------|------|
| OpenID Discovery | `/.well-known/openid-configuration` | GET | 返回 OpenID Connect Provider 元数据 |
| Authorization | `/api/auth/oauth2/authorize` | GET | 实现 Authorization Code + PKCE 授权流程 |
| Token Exchange | `/api/auth/oauth2/token` | POST | 使用 code 换取 access_token + refresh_token，或执行 refresh rotation |
| UserInfo | `/api/auth/oauth2/userinfo` | GET | 返回已认证用户的声明信息 |
| Introspection | `/api/auth/oauth2/introspect` | POST | 解码并验证活跃令牌（RFC 7662） |
| Revocation | `/api/auth/oauth2/revoke` | POST | 撤销活跃的 access token 或 refresh token（RFC 7009） |
| JWKS | `/api/auth/jwks` | GET | 暴露用于签名验证的公钥集合（JWK 格式） |
| Auth Callback | `/api/auth/callback` | GET | 后端回调处理器，交换授权码并设置 Cookie |

---

### 4.1 OIDC Discovery

`GET /.well-known/openid-configuration`

返回符合 [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html) 规范的 OpenID Connect Provider 元数据文档。

#### curl 示例
```bash
curl -X GET https://portal.example.com/.well-known/openid-configuration \
  -H 'Accept: application/json'
```

#### 成功响应 (200)
```json
{
  "issuer": "https://portal.example.com",
  "authorization_endpoint": "https://portal.example.com/api/auth/oauth2/authorize",
  "token_endpoint": "https://portal.example.com/api/auth/oauth2/token",
  "userinfo_endpoint": "https://portal.example.com/api/auth/oauth2/userinfo",
  "introspection_endpoint": "https://portal.example.com/api/auth/oauth2/introspect",
  "revocation_endpoint": "https://portal.example.com/api/auth/oauth2/revoke",
  "jwks_uri": "https://portal.example.com/.well-known/jwks",
  "scopes_supported": ["openid", "profile", "email", "offline_access"],
  "response_types_supported": ["code"],
  "response_modes_supported": ["query", "form_post"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["ES256"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
  "claims_supported": ["sub", "name", "email", "roles", "permissions"],
  "code_challenge_methods_supported": ["S256"],
  "require_pkce": true
}
```

---

### 4.2 Authorization Endpoint

`GET /api/auth/oauth2/authorize`

实现 OAuth 2.1 Authorization Code Flow，强制要求 PKCE。这是用户认证和授权的入口。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `response_type` | string | 是 | 必须为 `code` |
| `client_id` | string | 是 | 客户端注册时获取的 client ID |
| `redirect_uri` | string | 是 | 必须与已注册的 redirect URI 之一匹配 |
| `code_challenge` | string | 是 | code verifier 的 S256 哈希值（PKCE） |
| `code_challenge_method` | string | 是 | 必须为 `S256` |
| `state` | string | 推荐 | 用于 CSRF 防护的不透明值（会在回调中原样返回） |
| `scope` | string | 是 | 以空格分隔的 scope 列表：`openid profile email offline_access` |
| `nonce` | string | 推荐 | 用于防止重放攻击的不透明值 |

#### curl 示例（浏览器重定向）
该端点通常通过客户端应用的浏览器重定向访问，而非直接通过 curl 调用。客户端通过将用户浏览器重定向到以下地址来启动流程：

```text
https://portal.example.com/api/auth/oauth2/authorize?response_type=code&client_id=client_web_app&redirect_uri=https://app.example.com/callback&scope=openid%20profile%20email&code_challenge=KxwFctP4F1fRqD6E8zG9H0IjKlMnOpQrStUvWxYz&code_challenge_method=S256&state=xyz789&nonce=abc456
```

#### 成功响应
成功后，浏览器被重定向到已注册的 `redirect_uri`，并附带授权码和 state：

```text
HTTP/1.1 302 Found
Location: https://app.example.com/callback?code=authcode_v2_abc123xyz&state=xyz789
```

#### 错误响应（重定向附带错误）
```text
HTTP/1.1 302 Found
Location: https://app.example.com/callback?error=invalid_request&error_description=Missing+required+parameter%3A+code_challenge&state=xyz789
```

**常见错误码**（以查询参数形式返回至 redirect URI）：

| 错误码 | 说明 |
|------------|-------------|
| `invalid_request` | 缺少必填参数或参数无效 |
| `unauthorized_client` | 客户端未获授权使用请求的 grant type |
| `access_denied` | 用户拒绝授权或未通过认证 |
| `invalid_scope` | 请求的 scope 无效 |
| `server_error` | 服务器内部错误 |

---

### 4.3 Token Exchange

`POST /api/auth/oauth2/token`

使用授权码交换 access token 和 refresh token，或执行 refresh token rotation。此为后端通道端点（服务器到服务器，非浏览器重定向）。

**Authorization Code Grant**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `grant_type` | string | 是 | 必须为 `authorization_code` |
| `code` | string | 是 | 从 authorize 端点获取的授权码 |
| `redirect_uri` | string | 是 | 必须与授权请求中使用的 redirect_uri 一致 |
| `code_verifier` | string | 是 | 原始的 code verifier（PKCE 验证） |
| `client_id` | string | 是 | 用于公开客户端（无 client_secret） |
| `client_secret` | string | 条件必填 | 机密客户端需要提供 |

**Refresh Token Grant**：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `grant_type` | string | 是 | 必须为 `refresh_token` |
| `refresh_token` | string | 是 | 之前 token exchange 获取的 refresh token |
| `client_id` | string | 是 | 客户端 ID |
| `client_secret` | string | 条件必填 | 机密客户端需要提供 |
| `scope` | string | 否 | 可选：请求原始 scope 的子集 |

#### curl 示例: Authorization Code
```bash
curl -X POST https://portal.example.com/api/auth/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=authorization_code' \
  -d 'code=authcode_v2_abc123xyz' \
  -d 'redirect_uri=https://app.example.com/callback' \
  -d 'code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' \
  -d 'client_id=client_web_app' \
  -d 'client_secret=sk_live_abc123def456xyz789'
```

#### curl 示例: Refresh Token
```bash
curl -X POST https://portal.example.com/api/auth/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=refresh_token' \
  -d 'refresh_token=rt_v2_abc123def456' \
  -d 'client_id=client_web_app' \
  -d 'client_secret=sk_live_abc123def456xyz789'
```

#### 成功响应 (Authorization Code)
```json
{
  "access_token": "eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV9hYmMxMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_v2_abc123def456",
  "id_token": "eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJuYW1lIjoiSm9obiBEb2UiLCJlbWFpbCI6ImpvaG5AZXhhbXBsZS5jb20iLCJpc3MiOiJodHRwczovL3BvcnRhbC5leGFtcGxlLmNvbSIsImF1ZCI6ImNsaWVudF93ZWJfYXBwIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.nviKz6Qs4Ft_Vh0nFd6Gz8JkT_Mio8iUJ5Gd7wEHh5z0xR2sY3pA9qBnLcDeFgHjKlMnOpQrStUvWxYz",
  "scope": "openid profile email"
}
```

#### 成功响应 (Refresh Token)
```json
{
  "access_token": "eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV9kZWY0NTYiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.mH8iJ5kL6nMoPqRrStUvWxYz0AbCdEfGhIjKlMnOpQrStUvWxYz",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_v2_def456ghi789",
  "scope": "openid profile email"
}
```

> **Token Rotation**：每次刷新都会返回新的 `refresh_token`，旧的 refresh token 立即失效。

#### 错误响应 (400) -- 授权码无效
```json
{
  "error": "invalid_grant",
  "error_description": "Authorization code is invalid or expired"
}
```

#### 错误响应 (400) -- PKCE 验证失败
```json
{
  "error": "invalid_grant",
  "error_description": "Code verifier does not match code challenge"
}
```

#### 错误响应 (401) -- 客户端凭据无效
```json
{
  "error": "invalid_client",
  "error_description": "Client authentication failed"
}
```

---

### 4.4 UserInfo

`GET /api/auth/oauth2/userinfo`

返回符合 [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) 规范的已认证用户声明信息。

**认证方式**: 需要 `Authorization: Bearer <access_token>` 请求头。

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/auth/oauth2/userinfo \
  -H "Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV9hYmMxMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw" \
  -H 'Accept: application/json'
```

#### 成功响应 (200)
```json
{
  "sub": "u_1",
  "name": "John Doe",
  "email": "john@example.com",
  "roles": ["super_admin"],
  "permissions": ["user:list", "user:create", "role:list"]
}
```

#### 错误响应 (401) -- Token 无效或已过期
```json
{
  "error": "invalid_token",
  "error_description": "The access token is invalid or has expired"
}
```

---

### 4.5 Token Introspection

`POST /api/auth/oauth2/introspect`

验证并返回活跃令牌的元数据，遵循 [RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662) 规范。支持 introspection 两种类型的令牌：access token（JWT）和 refresh token（不透明）。

**认证方式**: 需要 `Authorization: Bearer <access_token>` 请求头（使用有效的管理员令牌），或使用 `client_id`/`client_secret` 进行客户端认证。

**请求体**（application/x-www-form-urlencoded）：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `token` | string | 是 | 需要 introspection 的令牌 |
| `token_type_hint` | string | 否 | 提示：`access_token` 或 `refresh_token` |

#### curl 示例
```bash
curl -X POST https://portal.example.com/api/auth/oauth2/introspect \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV9hYmMxMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw' \
  -d 'token=eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV9hYmMxMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw'
```

#### 成功响应 (Active Token - 200)
```json
{
  "active": true,
  "sub": "u_1",
  "client_id": "client_web_app",
  "token_type": "access_token",
  "scope": "openid profile email",
  "iss": "https://portal.example.com",
  "iat": 1717798000,
  "exp": 1717801600,
  "jti": "jti_abc123"
}
```

#### 成功响应 (Inactive Token - 200)
```json
{
  "active": false
}
```

> **注意**：RFC 7662 规定成功响应始终返回 HTTP 200。通过 `active` 字段区分有效和无效令牌。

---

### 4.6 Token Revocation

`POST /api/auth/oauth2/revoke`

撤销活跃的 access token 或 refresh token，遵循 [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) 规范。

**请求体**（application/x-www-form-urlencoded）：

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `token` | string | 是 | 需要撤销的令牌 |
| `token_type_hint` | string | 否 | 提示：`access_token` 或 `refresh_token` |

**认证方式**：发起请求的客户端必须通过以下方式之一进行认证：
- `Authorization: Bearer <access_token>` 请求头（用户发起的撤销），或
- 请求体中的 `client_id` + `client_secret`（客户端发起的撤销）

#### curl 示例 (User-Initiated)
```bash
curl -X POST https://portal.example.com/api/auth/oauth2/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV9hYmMxMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw" \
  -d 'token=rt_v2_abc123def456' \
  -d 'token_type_hint=refresh_token'
```

#### curl 示例 (Client-Initiated)
```bash
curl -X POST https://portal.example.com/api/auth/oauth2/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'token=rt_v2_abc123def456' \
  -d 'token_type_hint=refresh_token' \
  -d 'client_id=client_web_app' \
  -d 'client_secret=sk_live_abc123def456xyz789'
```

#### 成功响应 (200)
```json
{}
```

> **注意**：RFC 7009 规定成功响应始终返回 HTTP 200，即使 token 已不存在或已过期（防止枚举攻击）。客户端应忽略响应体。

---

### 4.7 JWKS 端点

`GET /api/auth/jwks`

返回包含用于 JWT 签名验证的公钥的 JSON Web Key Set（JWKS）。该端点由 Rust Gateway 和需要离线验证 Access Token 的外部服务使用。

#### curl 示例
```bash
curl -X GET https://portal.example.com/api/auth/jwks \
  -H 'Accept: application/json'
```

#### 成功响应 (200)
```json
{
  "keys": [
    {
      "kty": "EC",
      "crv": "P-256",
      "kid": "sig_key_01",
      "x": "f83OJ3D2K1P1jS36hG2ZkzJ7M5L8qR0tUvWxYzAbCdEfGhIjKlMnOpQ",
      "y": "rStUvWxYz0AbCdEfGhIjKlMnOpQrStUvWxYz1B2c3D4e5F6g7H8i9J0k",
      "use": "sig",
      "alg": "ES256"
    }
  ]
}
```

同一密钥集也可通过 `GET /.well-known/jwks` 获取（在 OIDC Discovery 文档中引用）。

---

### 4.8 完整 Authorization Code + PKCE 流程示例

本节演示使用 curl 命令完成的完整 OAuth 2.1 Authorization Code + PKCE 流程。

**前置条件**：
- 已注册的 OAuth 客户端，`client_id: client_web_app`，`redirect_uri: https://app.example.com/callback`
- 用户账户：邮箱 `admin@example.com`，密码 `Admin123!`

#### Step 1: 生成 PKCE 参数

客户端生成一个加密随机 `code_verifier`，并计算其 S256 哈希值作为 `code_challenge`。

```bash
# 生成随机 code_verifier（43-128 个字符，仅限非保留字符）
code_verifier=$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-64)
echo "code_verifier: $code_verifier"
# 示例输出: dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk

# 计算 code_challenge = Base64URL(SHA256(code_verifier))
code_challenge=$(echo -n "$code_verifier" | openssl dgst -sha256 -binary | openssl base64 -A | tr '/+' '_-' | tr -d '=')
echo "code_challenge: $code_challenge"
# 示例输出: KxwFctP4F1fRqD6E8zG9H0IjKlMnOpQrStUvWxYz
```

#### Step 2: 用户登录

客户端通过 API 将用户发送至登录页面：

```bash
curl -X POST https://portal.example.com/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"admin@example.com","password":"Admin123!"}'
```

成功后，响应会在 `cookies.txt` 中设置 `login_session` Cookie。

#### Step 3: 浏览器重定向至 Authorize 端点

客户端将用户浏览器重定向到授权端点（此处用 curl 模拟重定向跳转）：

```bash
curl -X GET "https://portal.example.com/api/auth/oauth2/authorize?response_type=code&client_id=client_web_app&redirect_uri=https://app.example.com/callback&scope=openid+profile+email&code_challenge=$code_challenge&code_challenge_method=S256&state=xyz789&nonce=abc456" \
  -b cookies.txt \
  -c cookies.txt \
  -L \
  -o /dev/null \
  -w '%{redirect_url}'
```

响应重定向至 `https://app.example.com/callback?code=authcode_v2_abc123xyz&state=xyz789`。

从重定向 URL 中提取 `code` 参数。

#### Step 4: 使用 Code 换取 Token

```bash
curl -X POST https://portal.example.com/api/auth/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=authorization_code' \
  -d "code=authcode_v2_abc123xyz" \
  -d 'redirect_uri=https://app.example.com/callback' \
  -d "code_verifier=$code_verifier" \
  -d 'client_id=client_web_app'
```

**响应**：
```json
{
  "access_token": "eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV9hYmMxMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_v2_abc123def456",
  "id_token": "eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJuYW1lIjoiSm9obiBEb2UiLCJlbWFpbCI6ImpvaG5AZXhhbXBsZS5jb20iLCJpc3MiOiJodHRwczovL3BvcnRhbC5leGFtcGxlLmNvbSIsImF1ZCI6ImNsaWVudF93ZWJfYXBwIiwiaWF0IjoxNzE3Nzk4MDAwLCJleHAiOjE3MTc4MDE2MDB9.nviKz6Qs4Ft_Vh0nFd6Gz8JkT_Mio8iUJ5Gd7wEHh5z0xR2sY3pA9qBnLcDeFgHjKlMnOpQrStUvWxYz",
  "scope": "openid profile email"
}
```

#### Step 5: 使用 Access Token 调用 UserInfo

```bash
ACCESS_TOKEN="eyJhbGciOiJFUzI1NiIsImtpZCI6InNpZ19rZXlfMDEifQ.eyJzdWIiOiJ1XzEiLCJyb2xlcyI6WyJzdXBlcl9hZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiLCJyb2xlOmxpc3QiXSwiZGF0YVNjb3BlVHlwZSI6IkFMTCIsImp0aSI6Imp0aV9hYmMxMjMiLCJpYXQiOjE3MTc3OTgwMDAsImV4cCI6MTcxNzgwMTYwMH0.hXuJXjtHQhHZ0fpy0zFT2_1uIiCEhGiA8wQpYROdmmzN4qgZFgVl5g9nGq-NBgPYWvYgcegkx8Q_gquWmNk3Qw"

curl -X GET https://portal.example.com/api/auth/oauth2/userinfo \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**响应**：
```json
{
  "sub": "u_1",
  "name": "John Doe",
  "email": "john@example.com",
  "roles": ["super_admin"],
  "permissions": ["user:list", "user:create", "role:list"]
}
```

#### Step 6: 刷新 Token（Access Token 过期时）

```bash
curl -X POST https://portal.example.com/api/auth/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=refresh_token' \
  -d 'refresh_token=rt_v2_abc123def456' \
  -d 'client_id=client_web_app'
```

**响应**：返回新的 access/refresh token 对。旧的 refresh token 立即失效。

---

## 5. 客户端 SDK 集成指南

### 5.1 OIDC 客户端库配置

如果你的应用使用标准的 OIDC 客户端库，请使用 Discovery URL 进行配置：

```text
https://portal.example.com/.well-known/openid-configuration
```

#### 示例: openid-client (Node.js)

```typescript
import { Issuer, generators } from 'openid-client';

// 发现 Provider 配置
const issuer = await Issuer.discover('https://portal.example.com/.well-known/openid-configuration');

// 创建客户端实例
const client = new issuer.Client({
  client_id: 'client_web_app',
  client_secret: 'sk_live_abc123def456xyz789',
  redirect_uris: ['https://app.example.com/callback'],
  response_types: ['code'],
  token_endpoint_auth_method: 'client_secret_basic',
});

// 生成 PKCE code challenge
const code_verifier = generators.codeVerifier();
const code_challenge = generators.codeChallenge(code_verifier);

// 生成 state 和 nonce 用于安全防护
const state = generators.state();
const nonce = generators.nonce();

// 构建 authorization URL
const authorizationUrl = client.authorizationUrl({
  scope: 'openid profile email',
  code_challenge,
  code_challenge_method: 'S256',
  state,
  nonce,
});

console.log('Redirect user to:', authorizationUrl);
// 重定向后：从回调 URL 中提取 code 和 state

// 使用 code 换取 tokens
const tokenSet = await client.authorizationCallback(
  'https://app.example.com/callback',
  { code: 'authcode_v2_abc123xyz', state },
  { code_verifier, nonce }
);

console.log('Access Token:', tokenSet.access_token);
console.log('Refresh Token:', tokenSet.refresh_token);

// 刷新 token
const newTokenSet = await client.refresh(tokenSet.refresh_token);
console.log('New Access Token:', newTokenSet.access_token);
```

#### 示例: AppAuth-JS (Browser / SPA)

```javascript
import { AuthorizationServiceConfiguration, AuthorizationRequest, TokenRequest } from '@openid/appauth';

// 获取服务配置
const config = await AuthorizationServiceConfiguration.fetchFromIssuer(
  'https://portal.example.com/.well-known/openid-configuration'
);

// 创建授权请求
const request = new AuthorizationRequest({
  client_id: 'client_web_app',
  redirect_uri: 'https://app.example.com/callback',
  scope: 'openid profile email',
  response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
  extras: {
    code_challenge: 'KxwFctP4F1fRqD6E8zG9H0IjKlMnOpQrStUvWxYz',
    code_challenge_method: 'S256',
  },
});

// 将用户重定向至 authorizationUrl
console.log(request.toString());
```

### 5.2 手动 HTTP 集成

在无法使用 OIDC 库的环境中，直接通过 HTTP 请求实现标准 OAuth 2.1 Authorization Code + PKCE 流程。请参考第 4.8 节获取完整的 curl 分步示例。

**集成检查清单**：

| 步骤 | 操作 | 端点 | 详情 |
|------|--------|----------|---------|
| 1 | 生成 PKCE 参数 | 客户端 | 生成 `code_verifier` 和 `code_challenge`（S256） |
| 2 | 构建 authorization URL | 客户端 | 构建包含 `response_type=code`、`client_id`、`redirect_uri`、`code_challenge`、`scope`、`state` 的 URL |
| 3 | 重定向用户 | `GET /api/auth/oauth2/authorize` | 用户进行认证和授权 |
| 4 | 接收回调 | 客户端回调 URL | 从查询参数中提取 `code` 和 `state` |
| 5 | 交换 code | `POST /api/auth/oauth2/token` | 发送 `code`、`code_verifier`、`redirect_uri`、`client_id` |
| 6 | 使用 access token | `GET /api/auth/oauth2/userinfo` | 添加 `Authorization: Bearer <access_token>` 请求头 |
| 7 | 刷新 tokens | `POST /api/auth/oauth2/token` | 发送 `grant_type=refresh_token` 和 `refresh_token` |

**配置参考**：

| 配置项 | 值 |
|---------------|-------|
| Authorization Endpoint | `https://portal.example.com/api/auth/oauth2/authorize` |
| Token Endpoint | `https://portal.example.com/api/auth/oauth2/token` |
| UserInfo Endpoint | `https://portal.example.com/api/auth/oauth2/userinfo` |
| Introspection Endpoint | `https://portal.example.com/api/auth/oauth2/introspect` |
| Revocation Endpoint | `https://portal.example.com/api/auth/oauth2/revoke` |
| JWKS URI | `https://portal.example.com/.well-known/jwks` |
| Issuer 标识符 | `https://portal.example.com` |
| 支持的 Grant Types | `authorization_code`, `refresh_token` |
| PKCE 方法 | 强制 `S256` |
| 签名算法 | `ES256` (ECDSA P-256) |
| Access Token TTL | 1 小时 |
| Refresh Token TTL | 7 天 |
| Authorization Code TTL | 1 分钟（一次性使用） |

---

## 附录：错误码汇总

| HTTP 状态码 | 错误码 | 说明 |
|-------------|------------|-------------|
| 400 | `BAD_REQUEST` | 参数校验失败 |
| 400 | `INVALID_GRANT` | 授权码或 refresh token 无效/已过期 |
| 400 | `INVALID_CLIENT` | 客户端认证失败 |
| 401 | `UNAUTHORIZED` | JWT Cookie 无效或缺失 |
| 401 | `INVALID_CREDENTIALS` | 邮箱或密码错误 |
| 401 | `INVALID_TOKEN` | Access token 无效或已过期 |
| 403 | `FORBIDDEN` | 权限不足 |
| 403 | `ACCOUNT_DISABLED` | 用户账户已被禁用 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `USER_ALREADY_EXISTS` | 邮箱已被使用 |
| 429 | `RATE_LIMITED` | 请求过于频繁 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |
