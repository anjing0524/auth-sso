# 数据库设计 - Auth-SSO

版本：v3.2
状态：已发布
最后更新：2026-06-24

> **v3.2 重大变更 — RBAC 权限模型重构**：删除 `data_scope_type` 枚举和 `role_data_scopes`、`role_clients` 两张关联表；角色新增 `dept_id` 字段（FK → `departments.id`），以「角色所属部门」替代独立的数据范围配置。数据访问控制从「dataScopeType 五种分支」简化为「角色部门 ID 列表 + 子树展开」的单一模型。详见 [RBAC_MODEL_REDESIGN.md](./RBAC_MODEL_REDESIGN.md)。
>
> **文档合并说明**：本版本吸收了先前独立的 DATABASE-DBA-REVIEW.md、DATABASE-DRIZZLE-AUDIT.md、DATABASE_FIX_PLAN.md、DATABASE_REDESIGN.md 中的关键决策与审查结论。原始审查/修复/重建文档已归档移除，所有有效信息统一在本文件中维护。

---

## 1. 存储架构

Auth-SSO 采用 PostgreSQL 与 Redis 的混合存储方案。为简化部署、提升效率并保证数据一致性，所有实体均位于**单个物理 PostgreSQL 数据库**中，同时维持严格的**逻辑隔离**。

### 1.1 逻辑数据域
- **Portal 核心域**：包含业务逻辑数据，如用户、组织架构（部门）、菜单、审计日志以及 RBAC（角色、权限）。
- **OIDC Provider 域**：包含 OIDC 客户端配置、授权码、活跃令牌、用户授权记录以及密钥对（JWKS）。

### 1.2 Redis 键空间

| 键前缀 | 用途 | TTL | 管理方 |
| --- | --- | --- | --- |
| `portal:jti_blocklist:` | JWT jti 紧急撤销黑名单 | 令牌剩余有效期 | Portal BFF |
| `portal:user_perms:` | 用户权限上下文缓存 | 3600 秒（与 Access Token TTL 对齐） | Portal BFF |

---

## 2. 命名约定

- **表名**：复数蛇形命名法（snake_case），例如 `users`、`roles`。
- **列名**：蛇形命名法（snake_case），例如 `dept_id`、`created_at`。
- **主键**：内部使用 `id`（text/uuid）作为关联标识，外部使用 `public_id`（text）在 API/UI 中可见。
- **外键**：默认引用内部 `id`。例外情况：`permissions.clientId` 和 `roleClients.clientId` 引用 `clients.clientId`（业务键）——原因见第 3.4 节。
- **状态**：所有实体均使用枚举类型的状态列。用户使用 `user_status` 枚举（`ACTIVE`、`DISABLED`、`LOCKED`、`DELETED`）。其他所有实体使用 `entity_status` 枚举（`ACTIVE`、`DISABLED`）。用户的软删除通过 `status = 'DELETED'` 实现。

---

## 3. Portal 域实体

### 3.1 用户表（`users`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | 内部 UUID |
| `public_id` | text | 唯一，非空 | 外部公开 ID（例如 `user_abc123`） |
| `username` | text | 唯一，非空 | 登录用户名 |
| `email` | text | 唯一 | 邮箱地址 |
| `email_verified` | boolean | 默认 false | 邮箱验证标记 |
| `mobile` | text | 唯一 | 手机号码 |
| `mobile_verified` | boolean | 默认 false | 手机验证标记 |
| `password_hash` | text | | 哈希后的密码 |
| `name` | text | 非空 | 显示名称 |
| `avatar_url` | text | | 头像图片 URL |
| `status` | user_status | 非空，默认 'ACTIVE' | `ACTIVE` / `DISABLED` / `LOCKED` / `DELETED` |
| `dept_id` | text | 外键 → departments.id，ON DELETE SET NULL | 所属部门 |
| `created_at` | timestamp | 非空，默认 now() | |
| `updated_at` | timestamp | 默认 now() | 自动更新 |
| `last_login_at` | timestamp | | 最后成功登录时间 |

**索引**：
- `status` 的部分索引，WHERE `status <> 'DELETED'`（覆盖列表查询）
- `dept_id` 的索引

**关联关系**：
- `userRoles` → 多个 `user_roles`
- `department` → 一个 `departments`（通过 `dept_id`）

### 3.2 部门表（`departments`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | 内部 UUID |
| `public_id` | text | 唯一，非空 | 外部公开 ID（例如 `dept_abc123`） |
| `parent_id` | text | | 自引用，用于树形层级 |
| `name` | text | 非空 | 部门名称 |
| `code` | text | | 业务编码 |
| `ancestors` | text | | 物化路径（例如 `dept_001/dept_002`），根节点为 NULL。无需递归 CTE 即可高效查询子树 |
| `sort` | integer | 默认 0 | 显示排序 |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `created_at` | timestamp | 非空，默认 now() | |
| `updated_at` | timestamp | 默认 now() | 自动更新 |

**索引**：
- `parent_id` 的索引
- `ancestors` 的索引

**通过 ancestors 进行子树查询**：
```sql
-- 查询 deptId 及其所有子部门
SELECT id FROM departments
WHERE id = :deptId OR ancestors LIKE :deptId || '/%'
```

### 3.3 角色表（`roles`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | 内部 UUID |
| `public_id` | text | 唯一，非空 | 外部公开 ID（例如 `role_abc123`） |
| `name` | text | 非空 | 角色显示名称 |
| `code` | text | 唯一，非空 | 角色编码（例如 `admin`、`editor`） |
| `description` | text | | |
| `dept_id` | text | NOT NULL，外键 → departments.id，ON DELETE CASCADE | **v3.2 新增**。角色所属部门，决定角色的数据可见范围。每个角色必须属于一个部门。删除部门时级联删除其下所有角色 |
| `is_system` | boolean | 默认 false | 系统角色不可删除 |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `sort` | integer | 默认 0 | |
| `created_at` | timestamp | 非空，默认 now() | |
| `updated_at` | timestamp | 默认 now() | 自动更新 |

> **v3.2 设计决策**：`data_scope_type` 列已移除。角色的数据范围由其 `dept_id` 隐式决定——角色能访问所属部门及其所有子部门的数据。每个角色必须属于一个部门（`dept_id` NOT NULL）。不再需要独立的 `data_scope_type` 枚举（ALL/DEPT/DEPT_AND_SUB/SELF/CUSTOM）。

### 3.4 权限表（`permissions`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | 内部 UUID |
| `public_id` | text | 唯一，非空 | 外部公开 ID（例如 `perm_abc123`） |
| `name` | text | 非空 | 权限显示名称 |
| `code` | text | 唯一，非空 | 权限编码（例如 `user.create`） |
| `type` | permission_type | 非空，默认 'API' | `MENU` / `API` / `DATA` |
| `resource` | text | | 资源路径（API 权限） |
| `action` | text | | 操作（API 权限） |
| `parent_id` | text | | 自引用，用于树形层级 |
| `client_id` | text | 外键 → clients.client_id | **引用业务 client_id，而非 clients.id**。原因见下方说明 |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `sort` | integer | 默认 0 | |
| `created_at` | timestamp | 非空，默认 now() | |
| `updated_at` | timestamp | 默认 now() | 自动更新 |

**索引**：
- `client_id` 的索引
- `parent_id` 的索引

> **为什么 `client_id` 引用 `clients.clientId`（业务键）而不是 `clients.id`？**
>
> Gateway（Rust/Pingora）和权限注册端点直接消费 `permissions.clientId`，且期望使用业务 `client_id` 值。由于 `clients.client_id` 具有 UNIQUE 约束，参照完整性与引用内部 `id` 等效。这是唯一有意为之的外键例外——所有其他外键均引用内部 `id`。

### 3.5 菜单表（`menus`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | 内部 UUID |
| `public_id` | text | 唯一，非空 | 外部公开 ID（例如 `menu_abc123`） |
| `parent_id` | text | | 自引用，用于树形层级 |
| `name` | text | 非空 | 菜单显示名称 |
| `path` | text | | 前端路由路径 |
| `permission_code` | text | | 访问所需权限编码 |
| `icon` | text | | 图标名称 |
| `component` | text | | 前端组件路径 |
| `visible` | boolean | 默认 true | |
| `sort` | integer | 默认 0 | |
| `menu_type` | menu_type | 非空，默认 'MENU' | `DIRECTORY` / `MENU` / `BUTTON` |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `created_at` | timestamp | 非空，默认 now() | |
| `updated_at` | timestamp | 默认 now() | 自动更新 |

### 3.6 用户-角色关联表（`user_roles`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | |
| `user_id` | text | 外键 → users.id，ON DELETE CASCADE | |
| `role_id` | text | 外键 → roles.id，ON DELETE CASCADE | |
| `created_at` | timestamp | 非空，默认 now() | |

**唯一索引**：`(user_id, role_id)` —— 防止重复分配角色。

### 3.7 角色-权限关联表（`role_permissions`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | |
| `role_id` | text | 外键 → roles.id，ON DELETE CASCADE | |
| `permission_id` | text | 外键 → permissions.id，ON DELETE CASCADE | |
| `created_at` | timestamp | 非空，默认 now() | |

**唯一索引**：`(role_id, permission_id)` —— 防止重复绑定。

---

## 4. OIDC Provider 域实体

### 4.1 OAuth 客户端表（`clients`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | 内部 UUID |
| `public_id` | text | 唯一，非空 | 外部公开 ID（例如 `cli_abc123`） |
| `name` | text | 非空 | 客户端应用名称 |
| `client_id` | text | 唯一，非空 | OAuth 2.1 客户端标识符 |
| `client_secret` | text | | OAuth 2.1 客户端密钥（公开客户端可为空） |
| `redirect_uris` | text[] | 非空 | 允许的重定向 URI（PostgreSQL 原生文本数组） |
| `scopes` | text | 非空，默认 'openid profile email offline_access' | 以空格分隔的 OAuth 范围（符合 RFC 6749） |
| `homepage_url` | text | | 客户端首页 |
| `logo_url` | text | | 客户端 Logo 图片 URL |
| `access_token_ttl` | integer | 默认 3600 | Access Token 有效期（秒） |
| `refresh_token_ttl` | integer | 默认 604800 | Refresh Token 有效期（秒） |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `created_at` | timestamp | 非空，默认 now() | |
| `updated_at` | timestamp | 默认 now() | 自动更新 |

### 4.2 授权码表（`authorization_codes`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | |
| `code` | text | 唯一，非空 | 授权码 |
| `client_id` | text | 外键 → clients.id，ON DELETE CASCADE | |
| `user_id` | text | 外键 → users.id，ON DELETE CASCADE | 资源所有者 |
| `redirect_uri` | text | 非空 | 请求中使用的确切重定向 URI |
| `scope` | text | 非空 | 请求的权限范围 |
| `state` | text | | OAuth state 参数 |
| `nonce` | text | | OIDC nonce 参数 |
| `code_challenge` | text | | PKCE 代码挑战值（RFC 7636） |
| `code_challenge_method` | code_challenge_method | 默认 'S256' | PKCE 挑战方法 |
| `expires_at` | timestamp | 非空 | 绝对过期时间 |
| `used` | boolean | 默认 false | 单次使用强制 |
| `created_at` | timestamp | 非空，默认 now() | |

### 4.3 访问令牌表（`access_tokens`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | |
| `token` | text | 唯一 | 令牌值哈希（用于令牌内省/撤销） |
| `client_id` | text | 外键 → clients.id，ON DELETE CASCADE | |
| `user_id` | text | 外键 → users.id，ON DELETE CASCADE | |
| `scopes` | text | 非空 | 已授予的权限范围 |
| `expires_at` | timestamp | | |
| `created_at` | timestamp | 非空，默认 now() | |
| `updated_at` | timestamp | 默认 now() | 自动更新 |

### 4.4 刷新令牌表（`refresh_tokens`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | |
| `token` | text | 唯一 | 令牌值哈希 |
| `client_id` | text | 外键 → clients.id，ON DELETE CASCADE | |
| `user_id` | text | 外键 → users.id，ON DELETE CASCADE | |
| `scopes` | text | 非空 | |
| `revoked` | timestamp | | 非空表示已撤销 |
| `auth_time` | timestamp | | 原始认证时间 |
| `created_at` | timestamp | 非空，默认 now() | |
| `updated_at` | timestamp | 默认 now() | 自动更新 |
| `expires_at` | timestamp | | |

### 4.5 用户授权记录表（`consents`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | |
| `user_id` | text | 外键 → users.id，ON DELETE CASCADE | |
| `client_id` | text | 外键 → clients.id，ON DELETE CASCADE | |
| `scopes` | text | 非空 | 用户已授权的权限范围 |
| `consent_given` | boolean | | 明确授权标记 |
| `created_at` | timestamp | 非空，默认 now() | |
| `updated_at` | timestamp | 默认 now() | 自动更新 |

**索引**：`(user_id, client_id)` —— 用于查询用户授权的复合索引。

### 4.6 JWKS 密钥表（`jwks`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | |
| `kid` | text | 唯一 | 密钥 ID（与 JWT 头中的 `kid` 匹配）。对于此字段为空的旧记录，回退使用 `id` |
| `algorithm` | jwk_algorithm | 默认 'ES256' | 签名算法 |
| `public_key` | text | 非空 | 公钥（JWK 格式） |
| `private_key` | text | 非空 | 私钥（JWK 格式） |
| `created_at` | timestamp | 非空，默认 now() | |
| `expires_at` | timestamp | | 密钥轮换过期时间 |

---

## 5. 审计与日志表

### 5.1 审计日志表（`audit_logs`）

仅追加的操作审计跟踪。**无外键约束** —— 日志必须在实体删除后仍保留。

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | |
| `user_id` | text | | 操作用户 ID（无外键，用户删除后仍保留） |
| `username` | text | | 操作用户名（冗余副本，用于日志自包含） |
| `operation` | text | 非空 | 审计操作类型 |
| `method` | text | | HTTP 方法 |
| `url` | text | | 请求 URL |
| `params` | jsonb | | 结构化请求参数（PostgreSQL JSONB） |
| `ip` | text | | 客户端 IP 地址 |
| `user_agent` | text | | |
| `status` | integer | | HTTP 响应状态码 |
| `duration` | integer | | 请求时长（毫秒） |
| `error_msg` | text | | 失败时的错误消息 |
| `created_at` | timestamp | 非空，默认 now() | |

### 5.2 登录日志表（`login_logs`）

仅追加的登录事件跟踪。**无外键约束** —— 原因同审计日志。

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | text | 主键 | |
| `user_id` | text | | 操作用户 ID（无外键） |
| `username` | text | 非空 | 操作用户名（冗余副本） |
| `event_type` | text | 非空 | `LOGIN_SUCCESS` / `LOGIN_FAILED` / `LOGOUT` / `TOKEN_REFRESH` / `TOKEN_REFRESH_FAILED` |
| `ip` | text | | |
| `user_agent` | text | | |
| `location` | text | | 地理位置（如有） |
| `fail_reason` | text | | 登录失败原因 |
| `created_at` | timestamp | 非空，默认 now() | |

---

## 6. PostgreSQL 枚举定义

| 枚举名称 | 取值 | 使用位置 |
|-----------|--------|---------|
| `user_status` | `ACTIVE`、`DISABLED`、`LOCKED`、`DELETED` | users.status |
| `entity_status` | `ACTIVE`、`DISABLED` | roles、permissions、departments、menus、clients |
| `permission_type` | `MENU`、`API`、`DATA` | permissions.type |
| `menu_type` | `DIRECTORY`、`MENU`、`BUTTON` | menus.menu_type |
| `jwk_algorithm` | `ES256` | jwks.algorithm |
| `code_challenge_method` | `S256` | authorization_codes.code_challenge_method |

> **v3.2 变更**：`data_scope_type` 枚举（`ALL`/`DEPT`/`DEPT_AND_SUB`/`SELF`/`CUSTOM`）已移除。数据范围由角色所属部门（`roles.dept_id`）隐式决定。

所有枚举值在 `@auth-sso/contracts` 中定义为唯一数据源，并通过 `apps/portal/src/db/schema/enums.ts` 重新导出。

---

## 7. 外键汇总

| 源表 | 源列 | 目标表 | 目标列 | 删除策略 |
|-------------|---------------|--------------|---------------|-----------|
| `users` | `dept_id` | `departments` | `id` | SET NULL |
| `roles` | `dept_id` | `departments` | `id` | CASCADE |
| `user_roles` | `user_id` | `users` | `id` | CASCADE |
| `user_roles` | `role_id` | `roles` | `id` | CASCADE |
| `role_permissions` | `role_id` | `roles` | `id` | CASCADE |
| `role_permissions` | `permission_id` | `permissions` | `id` | CASCADE |
| `permissions` | `client_id` | `clients` | `client_id` * | CASCADE |
| `authorization_codes` | `client_id` | `clients` | `id` | CASCADE |
| `authorization_codes` | `user_id` | `users` | `id` | CASCADE |
| `access_tokens` | `client_id` | `clients` | `id` | CASCADE |
| `access_tokens` | `user_id` | `users` | `id` | CASCADE |
| `refresh_tokens` | `client_id` | `clients` | `id` | CASCADE |
| `refresh_tokens` | `user_id` | `users` | `id` | CASCADE |
| `consents` | `user_id` | `users` | `id` | CASCADE |
| `consents` | `client_id` | `clients` | `id` | CASCADE |

> \* `permissions.client_id` 引用 `clients.client_id`（业务键）而非 `clients.id`。这是有意为之——Gateway 和权限注册端点直接消费业务 `client_id`。`clients.client_id` 具有 UNIQUE 约束，因此参照完整性与引用内部 `id` 等效。
>
> **v3.2 已移除的外键**：`role_data_scopes`（role_id → roles.id, dept_id → departments.id）、`role_clients`（role_id → roles.id, client_id → clients.client_id）。这两张表随 RBAC 模型简化一并删除。

---

## 8. Redis 键结构

### 8.1 Portal jti 黑名单（紧急撤销）

**键**：`portal:jti_blocklist:{jti}`
**值**：`1`
**TTL**：JWT 的剩余生命周期（token 过期时间 - 当前时间），最少 1 秒。
**用途**：支持账号封禁、密码更改和强制登出时的即时令牌失效。TTL 自动在令牌自然过期时删除该键，防止 Redis 无限制增长。

### 8.2 Portal 权限上下文缓存

**键**：`portal:user_perms:{userId}`
**值**（JSON）：
```json
{
  "roles": [
    { "id": "role_1", "code": "admin", "name": "Administrator", "deptId": "dept_001" }
  ],
  "permissions": ["user:list", "user:create", "role:assign"],
  "deptIds": ["dept_001", "dept_002"]
}
```
**TTL**：3600 秒（与 Access Token TTL 对齐）。
**用途**：缓存用户的角色/权限/数据范围上下文，避免每次 API 请求重复查询数据库。在令牌签发时主动预填充（`cacheUserPermissionContext`）。Redis 故障时优雅降级为直接数据库查询。

> **v3.2 变更**：`dataScopeType` 和 `deptId` 字段已移除，替换为 `deptIds`（用户所拥有角色的部门 ID 列表，含子树展开）。每个角色增加 `deptId` 字段标识其所属部门。

---

## 9. 实现说明

1. **软删除**：用户使用 `status = 'DELETED'`。其他所有实体使用 `status = 'DISABLED'`（不实现硬删除——采用基于状态的生命周期管理）。
2. **索引**：对 `username`、`client_id`、`public_id`、外键列以及审计表的 `created_at` 建有索引。部分索引用于带过滤条件的查询（如活跃用户）。
3. **树形结构**：部门、菜单和权限使用自引用 `parent_id`。部门额外使用 `ancestors` 物化路径，无需递归 CTE 即可高效查询子树。
4. **Drizzle 关联关系**：在 `apps/portal/src/db/schema/relations.ts` 中声明。支持 `db.query.table.findMany({ with: {...} })` 实现嵌套对象加载。复杂报表查询仍使用手动 JOIN。
5. **ID 策略**：所有实体同时拥有 `id`（内部 UUID）和 `public_id`（外部，带前缀）。外部 API 接受两者；内部查找使用 `byIdOrPublicId()` 辅助函数。
6. **共享数据库**：Portal 核心域和 OIDC Provider 域共用同一物理数据库，以保持简单性和参照完整性。
