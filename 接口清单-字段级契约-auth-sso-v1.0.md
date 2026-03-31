# 小企业统一门户 + SSO + 权限中心接口清单 / 字段级契约

- 关联 PRD：[PRD-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/PRD-auth-sso-v1.0.md)
- 关联实施清单：[研发实施清单-里程碑-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/研发实施清单-里程碑-auth-sso-v1.0.md)
- 文档版本：`v1.0`
- 用途：前后端并行开发、联调、测试用例编写

---

## 1. 接口约定总则

### 1.1 域内角色

- `Portal API`：门户前后端、管理后台使用
- `IdP OIDC API`：Portal 与子应用对接认证中心使用

### 1.2 通用请求约定

- 协议：`HTTPS`
- 编码：`UTF-8`
- Body：默认 `application/json`
- 时间字段：默认 `ISO 8601` 字符串，示例 `2026-03-19T12:00:00Z`

### 1.3 通用响应结构

成功响应：

```json
{
  "code": "OK",
  "message": "success",
  "data": {}
}
```

失败响应：

```json
{
  "code": "UNAUTHORIZED",
  "message": "session expired",
  "requestId": "req_123456"
}
```

### 1.4 通用错误码

| 错误码 | HTTP 状态码 | 说明 |
| --- | --- | --- |
| OK | 200 | 成功 |
| BAD_REQUEST | 400 | 参数错误 |
| UNAUTHORIZED | 401 | 未登录或登录失效 |
| FORBIDDEN | 403 | 无权限 |
| NOT_FOUND | 404 | 资源不存在 |
| CONFLICT | 409 | 数据冲突 |
| VALIDATION_ERROR | 422 | 字段校验失败 |
| TOO_MANY_REQUESTS | 429 | 访问频率受限 |
| INTERNAL_ERROR | 500 | 系统内部错误 |
| UPSTREAM_ERROR | 502 | 上游 IdP 异常 |

### 1.5 分页结构

```json
{
  "list": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

### 1.6 鉴权约定

- Portal 页面请求依赖 `portal_session` Cookie
- 管理接口必须校验登录态和权限码
- IdP `/token` 等敏感接口为服务端调用，不向浏览器直接开放凭证能力
- 登录回跳地址仅允许 Portal 站内相对路径

### 1.7 ID 约定

- 接口中的 `id` 默认指外部字符串 ID
- 所有路径参数 `:id`、响应体中的 `id`、以及 `deptId / roleIds / clientId` 等关联字段，默认都表示对应实体的 `public_id`
- 数据库内部主键使用 `bigint`
- 前后端不感知数据库内部主键

---

## 2. Portal 认证接口

## 2.1 `GET /api/me`

### 用途

返回当前登录用户、菜单、权限上下文。

### 鉴权

- 可匿名访问

### 请求参数

无

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "authenticated": true,
    "user": {
      "id": "u_1",
      "username": "zhangsan",
      "name": "张三",
      "email": "zhangsan@example.com",
      "mobile": "13800000000",
      "status": "ACTIVE",
      "deptId": "d_1",
      "deptName": "市场部",
      "roles": [
        {
          "id": "r_1",
          "code": "admin",
          "name": "管理员"
        }
      ],
      "permissions": [
        "user.read",
        "user.create",
        "client.read"
      ]
    },
    "menus": [
      {
        "id": "m_1",
        "name": "用户管理",
        "path": "/admin/users",
        "icon": "users",
        "children": []
      }
    },
    "session": {
      "sessionId": "sess_xxx",
      "expiresAt": "2026-03-19T16:00:00Z",
      "idleTimeoutSec": 1800
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| data.authenticated | boolean | 是 | 是否已登录 |
| data.user.id | string | 是 | 用户 ID |
| data.user.username | string | 是 | 登录名 |
| data.user.name | string | 是 | 姓名 |
| data.user.email | string | 否 | 邮箱 |
| data.user.mobile | string | 否 | 手机号 |
| data.user.status | string | 是 | `ACTIVE / DISABLED / LOCKED` |
| data.user.deptId | string | 否 | 主部门 ID |
| data.user.deptName | string | 否 | 主部门名称 |
| data.user.roles | array | 是 | 当前角色列表 |
| data.user.permissions | array | 是 | 权限码列表 |
| data.menus | array | 是 | 当前可见菜单 |
| data.session.sessionId | string | 是 | 当前会话 ID |
| data.session.expiresAt | string | 是 | 会话绝对过期时间 |
| data.session.idleTimeoutSec | number | 是 | 空闲超时时长，单位秒 |

### 未登录响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "authenticated": false
  }
}
```

---

## 2.2 `GET /api/auth/login`

### 用途

发起 Portal 登录流程，重定向至 IdP `/authorize`。

### 鉴权

- 无需登录

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| redirect | string | 否 | 登录成功后 Portal 内跳转地址，必须是 Portal 站内相对路径，默认 `/` |

### 行为

- 生成 `state`
- 生成 `nonce`
- 生成 `code_verifier` / `code_challenge`
- 校验 `redirect` 是否为站内相对路径
- 在服务端保存临时认证上下文：`state`、`nonce`、`code_verifier`、`redirect`
- 返回 302 到 IdP `/authorize`

### 成功结果

- HTTP `302`

### 错误码

- `BAD_REQUEST`：非法 redirect
- `INTERNAL_ERROR`：认证上下文生成失败

---

## 2.3 `GET /api/auth/callback`

### 用途

接收 IdP 回调，完成授权码换 Token、身份解析与 Session 建立。

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | string | 是 | IdP 返回的授权码 |
| state | string | 是 | 防 CSRF 状态值 |

### 行为

- 校验 `state`
- 读取与 `state` 绑定的临时认证上下文
- 调用 IdP `/token`
- 校验 `id_token`
- 建立 Portal Session
- 写入 `portal_session` Cookie
- 删除临时认证上下文
- 302 回安全校验通过的 `redirect`

### 成功结果

- HTTP `302`

### 错误码

| 错误码 | 场景 |
| --- | --- |
| BAD_REQUEST | 缺少 `code` 或 `state` |
| UNAUTHORIZED | `state` 不匹配 |
| BAD_REQUEST | `redirect` 非法或认证上下文不存在 |
| UPSTREAM_ERROR | `/token` 交换失败 |
| FORBIDDEN | 用户被禁用 |

---

## 2.4 `POST /api/auth/logout`

### 用途

退出 Portal 当前登录态。

### 鉴权

- 需要登录

### 请求体

```json
{
  "logoutAll": false
}
```

### 请求字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| logoutAll | boolean | 否 | 是否退出当前用户在 Portal 的所有会话，默认 `false` |

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "loggedOut": true
  }
}
```

### 登出语义

- 删除当前 Portal Session
- 清理 `portal_session` Cookie
- 同步使对应 `IdP Session` 失效
- 登出后再次访问 Portal 或重新发起 OIDC 流程时，必须重新登录

---

## 3. Portal 管理接口

## 3.1 用户管理

## 3.1.1 `GET /api/admin/users`

### 权限

- `user.read`

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| page | number | 否 | 页码，默认 `1` |
| pageSize | number | 否 | 每页条数，默认 `20`，最大 `100` |
| keyword | string | 否 | 用户名 / 姓名 / 手机 / 邮箱模糊搜索 |
| deptId | string | 否 | 部门筛选 |
| status | string | 否 | `ACTIVE / DISABLED / LOCKED` |

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "list": [
      {
        "id": "u_1",
        "username": "zhangsan",
        "name": "张三",
        "email": "zhangsan@example.com",
        "mobile": "13800000000",
        "status": "ACTIVE",
        "deptId": "d_1",
        "deptName": "市场部",
        "roleCodes": ["admin"],
        "lastLoginAt": "2026-03-19T12:00:00Z",
        "createdAt": "2026-03-01T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 1
    }
  }
}
```

## 3.1.2 `POST /api/admin/users`

### 权限

- `user.create`

### 请求体

```json
{
  "username": "zhangsan",
  "name": "张三",
  "email": "zhangsan@example.com",
  "mobile": "13800000000",
  "password": "Abcd1234!",
  "deptId": "d_1",
  "roleIds": ["r_1"],
  "status": "ACTIVE"
}
```

### 请求字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| username | string | 是 | 登录名，3-50 位，唯一 |
| name | string | 是 | 用户姓名，1-50 位 |
| email | string | 否 | 邮箱，唯一约束建议开启 |
| mobile | string | 否 | 手机号，唯一约束建议开启 |
| password | string | 是 | 初始密码，后端加密存储 |
| deptId | string | 否 | 主部门 ID |
| roleIds | string[] | 否 | 初始角色 ID 列表 |
| status | string | 是 | `ACTIVE / DISABLED` |

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "u_1"
  }
}
```

### 错误码

- `CONFLICT`：用户名、邮箱或手机号重复
- `VALIDATION_ERROR`：字段校验失败

## 3.1.3 `GET /api/admin/users/:id`

### 权限

- `user.read`

### Path 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | string | 是 | 用户 ID |

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "u_1",
    "username": "zhangsan",
    "name": "张三",
    "email": "zhangsan@example.com",
    "mobile": "13800000000",
    "status": "ACTIVE",
    "deptId": "d_1",
    "roleIds": ["r_1"],
    "createdAt": "2026-03-01T10:00:00Z",
    "updatedAt": "2026-03-10T10:00:00Z"
  }
}
```

## 3.1.4 `PUT /api/admin/users/:id`

### 权限

- `user.update`

### 请求体

```json
{
  "name": "张三",
  "email": "zhangsan@example.com",
  "mobile": "13800000000",
  "deptId": "d_1",
  "roleIds": ["r_1", "r_2"],
  "status": "ACTIVE"
}
```

## 3.1.5 `POST /api/admin/users/:id/reset-password`

### 权限

- `user.resetPassword`

### 请求体

```json
{
  "newPassword": "Abcd1234!"
}
```

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "reset": true
  }
}
```

### 错误码

- `NOT_FOUND`：用户不存在
- `FORBIDDEN`：无权限
- `VALIDATION_ERROR`：密码复杂度不符合要求
- `UPSTREAM_ERROR`：IdP 认证域更新失败

## 3.1.6 `POST /api/admin/users/:id/force-logout`

### 权限

- `user.forceLogout`

### 用途

- 删除该用户所有 Portal Session

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "forced": true
  }
}
```

### 错误码

- `NOT_FOUND`：用户不存在
- `FORBIDDEN`：无权限

---

## 3.2 部门管理

## 3.2.1 `GET /api/admin/departments`

### 权限

- `department.read`

### Query 参数

无

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": [
    {
      "id": "d_root",
      "parentId": null,
      "name": "总部",
      "code": "HQ",
      "leaderUserId": "u_1",
      "sort": 1,
      "status": "ACTIVE",
      "children": [
        {
          "id": "d_1",
          "parentId": "d_root",
          "name": "市场部",
          "code": "MKT",
          "leaderUserId": "u_2",
          "sort": 1,
          "status": "ACTIVE",
          "children": []
        }
      ]
    }
  ]
}
```

## 3.2.2 `POST /api/admin/departments`

### 权限

- `department.create`

### 请求体

```json
{
  "parentId": "d_root",
  "name": "市场部",
  "code": "MKT",
  "leaderUserId": "u_2",
  "sort": 1,
  "status": "ACTIVE"
}
```

## 3.2.3 `PUT /api/admin/departments/:id`

### 权限

- `department.update`

## 3.2.4 `DELETE /api/admin/departments/:id`

### 权限

- `department.delete`

### 删除约束

- 存在子部门不可直接删除
- 部门下仍有关联用户不可直接删除

---

## 3.3 角色管理

## 3.3.1 `GET /api/admin/roles`

### 权限

- `role.read`

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| page | number | 否 | 页码 |
| pageSize | number | 否 | 每页条数 |
| keyword | string | 否 | 角色名称 / 编码搜索 |
| status | string | 否 | `ACTIVE / DISABLED` |

## 3.3.2 `POST /api/admin/roles`

### 权限

- `role.create`

### 请求体

```json
{
  "name": "管理员",
  "code": "admin",
  "dataScope": "ALL",
  "permissionIds": ["p_1", "p_2"],
  "status": "ACTIVE",
  "remark": "系统管理员"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| name | string | 是 | 角色名称 |
| code | string | 是 | 角色编码，唯一 |
| dataScope | string | 是 | `ALL / DEPT / DEPT_AND_SUB / SELF / CUSTOM` |
| permissionIds | string[] | 否 | 绑定权限列表 |
| status | string | 是 | `ACTIVE / DISABLED` |
| remark | string | 否 | 备注 |

## 3.3.3 `GET /api/admin/roles/:id`

### 权限

- `role.read`

## 3.3.4 `PUT /api/admin/roles/:id`

### 权限

- `role.update`

## 3.3.5 `DELETE /api/admin/roles/:id`

### 权限

- `role.delete`

### 删除约束

- 已分配给用户的角色默认不可直接删除

---

## 3.4 权限管理

## 3.4.1 `GET /api/admin/permissions`

### 权限

- `permission.read`

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": [
    {
      "id": "p_1",
      "code": "user.read",
      "name": "查看用户",
      "type": "API",
      "resource": "/api/admin/users",
      "action": "GET",
      "status": "ACTIVE"
    }
  ]
}
```

## 3.4.2 `POST /api/admin/permissions`

### 权限

- `permission.create`

### 请求体

```json
{
  "code": "user.read",
  "name": "查看用户",
  "type": "API",
  "resource": "/api/admin/users",
  "action": "GET",
  "status": "ACTIVE"
}
```

## 3.4.3 `PUT /api/admin/permissions/:id`

### 权限

- `permission.update`

## 3.4.4 `DELETE /api/admin/permissions/:id`

### 权限

- `permission.delete`

---

## 3.5 Client 管理

## 3.5.1 `GET /api/admin/clients`

### 权限

- `client.read`

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| page | number | 否 | 页码 |
| pageSize | number | 否 | 每页条数 |
| keyword | string | 否 | 应用名 / clientId 搜索 |
| status | string | 否 | `ACTIVE / DISABLED` |

返回约束：

- 列表接口不返回明文 `clientSecret`

## 3.5.2 `POST /api/admin/clients`

### 权限

- `client.create`

### 请求体

```json
{
  "name": "报表系统",
  "clientId": "report-web",
  "clientSecret": "secret_xxx",
  "redirectUris": [
    "https://report.example.com/callback"
  ],
  "scopes": ["openid", "profile", "email"],
  "grantTypes": ["authorization_code", "refresh_token"],
  "status": "ACTIVE"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| name | string | 是 | 应用名称 |
| clientId | string | 是 | Client ID，唯一 |
| clientSecret | string | 是 | Secret，服务端加密保存 |
| redirectUris | string[] | 是 | 回调地址白名单 |
| scopes | string[] | 是 | 支持的 scope |
| grantTypes | string[] | 是 | 支持的授权类型 |
| status | string | 是 | `ACTIVE / DISABLED` |

响应约束：

- 创建成功后可一次性返回新生成或已提交的 `clientSecret`
- 后续普通查询接口不再返回明文 `clientSecret`

## 3.5.3 `GET /api/admin/clients/:id`

### 权限

- `client.read`

返回约束：

- 详情接口不返回明文 `clientSecret`
- 如需轮换 Secret，必须调用专用接口

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": "c_1",
    "name": "报表系统",
    "clientId": "report-web",
    "redirectUris": [
      "https://report.example.com/callback"
    ],
    "scopes": ["openid", "profile", "email"],
    "grantTypes": ["authorization_code", "refresh_token"],
    "status": "ACTIVE"
  }
}
```

## 3.5.4 `PUT /api/admin/clients/:id`

### 权限

- `client.update`

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "updated": true
  }
}
```

### 错误码

- `NOT_FOUND`：Client 不存在
- `CONFLICT`：`clientId` 或回调地址冲突
- `VALIDATION_ERROR`：字段校验失败

## 3.5.5 `POST /api/admin/clients/:id/rotate-secret`

### 权限

- `client.rotateSecret`

### 成功响应

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "clientSecret": "secret_new_xxx"
  }
}
```

### 错误码

- `NOT_FOUND`：Client 不存在
- `FORBIDDEN`：无权限

---

## 4. IdP 标准接口契约

说明：

- 以下接口为标准 OIDC / OAuth2 能力，Portal 与子应用以服务端方式对接
- 字段以 v1.0 所需最小能力为准
- Portal 登出后，IdP 必须无法继续基于旧会话直接签发新授权码

## 4.1 `GET /authorize`

### Query 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| response_type | string | 是 | 固定 `code` |
| client_id | string | 是 | Client ID |
| redirect_uri | string | 是 | 回调地址 |
| scope | string | 是 | 例如 `openid profile email` |
| state | string | 是 | 防 CSRF |
| nonce | string | 是 | 防重放 |
| code_challenge | string | 是 | PKCE challenge |
| code_challenge_method | string | 是 | 固定 `S256` |

### 成功结果

- 若 IdP 已登录：302 到 `redirect_uri?code=xxx&state=xxx`
- 若 IdP 未登录：跳转登录页，登录后再回跳

## 4.2 `POST /token`

### 请求头

```http
Content-Type: application/x-www-form-urlencoded
```

### 表单参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| grant_type | string | 是 | `authorization_code` 或 `refresh_token` |
| code | string | 条件必填 | 授权码模式时必填 |
| redirect_uri | string | 条件必填 | 授权码模式时必填 |
| client_id | string | 是 | Client ID |
| client_secret | string | 条件必填 | 机密客户端时必填 |
| code_verifier | string | 条件必填 | PKCE 校验值 |
| refresh_token | string | 条件必填 | 刷新模式时必填 |

### 成功响应

```json
{
  "access_token": "access_xxx",
  "id_token": "id_xxx",
  "refresh_token": "refresh_xxx",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

## 4.3 `GET /userinfo`

### 请求头

```http
Authorization: Bearer access_xxx
```

### 成功响应

```json
{
  "sub": "sub_xxx",
  "preferred_username": "zhangsan",
  "name": "张三",
  "email": "zhangsan@example.com",
  "phone_number": "13800000000"
}
```

说明：

- `sub` 为认证主体标识，对应 `portal_core.user_identities.subject`
- `sub` 不要求等于业务用户 `public_id`

## 4.4 `GET /.well-known/openid-configuration`

### 用途

- 返回 OIDC 元数据

## 4.5 `GET /jwks`

### 用途

- 返回签名公钥集合

---

## 5. 前后端联调约定

### 5.1 统一枚举

用户状态：

- `ACTIVE`
- `DISABLED`
- `LOCKED`

角色 / 权限 / Client / 部门状态：

- `ACTIVE`
- `DISABLED`

权限类型：

- `MENU`
- `API`
- `DATA`

数据范围：

- `ALL`
- `DEPT`
- `DEPT_AND_SUB`
- `SELF`
- `CUSTOM`

权限码命名：

- 管理权限采用原子权限码，如 `client.read`、`client.create`、`client.update`
- 不使用聚合权限码如 `client.manage`

### 5.2 前端处理原则

- `401`：跳转登录或弹出登录失效提示
- `403`：显示无权限提示
- `422`：显示字段校验错误
- `502`：显示“认证中心异常，请稍后再试”

### 5.3 后端处理原则

- 管理接口统一返回 JSON，不返回 HTML
- 登录 / 回调接口以跳转为主
- 删除类接口优先逻辑校验，不直接硬删除关键数据

### 5.4 前端实现约束

- Portal 前端项目使用 `Next.js App Router`
- Portal UI 组件库使用 `shadcn/ui`
- Portal 样式系统使用 `tailwindcss@latest`
- 组件展示逻辑可以做权限裁剪，但真正鉴权必须以后端接口为准

---

## 6. 最小联调清单

- `/api/auth/login`
- `/api/auth/callback`
- `/api/me`
- `/api/auth/logout`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/departments`
- `POST /api/admin/roles`
- `POST /api/admin/clients`
- `GET /authorize`
- `POST /token`

这些接口打通后，Portal 登录、权限管理和单子应用接入即可并行推进。
