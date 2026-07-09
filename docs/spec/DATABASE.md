# 数据库设计 - Auth-SSO

版本：v3.2
状态：已发布
最后更新：2026-06-25

> **v3.2 重大变更 — RBAC 权限模型重构**：删除 `data_scope_type` 枚举和 `role_data_scopes`、`role_clients` 两张关联表；角色新增 `dept_id` 字段（FK → `departments.id`），以「角色所属部门」替代独立的数据范围配置。数据访问控制从「dataScopeType 五种分支」简化为「角色部门 ID 列表 + 子树展开」的单一模型。详见 [RBAC_MODEL_REDESIGN.md](./RBAC_MODEL_REDESIGN.md)。
>
> **v2 基础架构变更**：全表 `text`→`uuid`/`varchar`、`timestamp`→`timestamptz`、移除 `public_id`、`clients.client_id` 为业务主键、`user_roles`/`role_permissions` 改为复合主键。本文件已完全同步至 `apps/portal/src/db/schema/*.ts`。
>
> **文档合并说明**：本版本吸收了先前独立的 DATABASE-DBA-REVIEW.md、DATABASE-DRIZZLE-AUDIT.md、DATABASE_FIX_PLAN.md、DATABASE_REDESIGN.md 中的关键决策与审查结论。原始审查/修复/重建文档已归档移除，所有有效信息统一在本文件中维护。

---

## 1. 存储架构

Auth-SSO 采用 PostgreSQL 与 Redis 的混合存储方案。为简化部署、提升效率并保证数据一致性，所有实体均位于**单个物理 PostgreSQL 数据库**中，同时维持严格的**逻辑隔离**。

### 1.1 逻辑数据域
- **Portal 核心域**：包含业务逻辑数据，如用户、组织架构（部门）、审计日志以及 RBAC（角色、权限）。
- **OIDC Provider 域**：包含 OIDC 客户端配置、授权码、活跃令牌以及密钥对（JWKS）。

### 1.2 Redis 键空间

| 键前缀 | 用途 | TTL | 管理方 |
| --- | --- | --- | --- |
| `portal:jti_blocklist:` | JWT jti 紧急撤销黑名单 | 令牌剩余有效期 | Portal BFF |
| `portal:user_perms:` | 用户权限上下文缓存 | 3600 秒（与 Access Token TTL 对齐） | Portal BFF |

---

## 2. 命名约定

- **表名**：复数蛇形命名法（snake_case），例如 `users`、`roles`。
- **列名**：蛇形命名法（snake_case），例如 `dept_id`、`created_at`。
- **主键**：统一 `uuid().defaultRandom()`，对外以 `id`（uuid）暴露，不再使用 `public_id`。
- **外键**：默认引用目标表主键。唯一例外：`permissions.client_id`、`authorization_codes.client_id`、`access_tokens.client_id`、`refresh_tokens.client_id` 引用 `clients.client_id`（业务键），因为 Gateway 和 OAuth 端点直接消费业务 `client_id`。`clients.client_id` 具有 UNIQUE 约束，参照完整性与引用内部 `id` 等效。
- **状态**：用户使用 `user_status` 枚举（`ACTIVE`、`DISABLED`、`LOCKED`、`DELETED`）。其他所有实体使用 `entity_status` 枚举（`ACTIVE`、`DISABLED`）。用户的软删除通过 `status = 'DELETED'` 实现。
- **时间列**：统一 `timestamptz`（`timestamp with timezone`），通过 `createdAtColumn()` / `updatedAtColumn()` helper 构造。

---

## 3. Portal 域实体

### 3.1 用户表（`users`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | 内部 UUID |
| `username` | varchar(50) | 唯一，非空 | 登录用户名 |
| `email` | varchar(255) | 唯一 | 邮箱地址 |
| `email_verified` | boolean | 非空，默认 false | 邮箱验证标记 |
| `mobile` | varchar(20) | 唯一 | 手机号码 |
| `mobile_verified` | boolean | 非空，默认 false | 手机验证标记 |
| `password_hash` | varchar(128) | | 哈希后的密码 |
| `name` | varchar(100) | 非空 | 显示名称 |
| `avatar_url` | varchar(500) | | 头像图片 URL |
| `status` | user_status | 非空，默认 'ACTIVE' | `ACTIVE` / `DISABLED` / `LOCKED` / `DELETED` |
| `dept_id` | uuid | 外键 → departments.id，ON DELETE SET NULL | 所属部门 |
| `last_login_at` | timestamptz | | 最后成功登录时间 |
| `deleted_at` | timestamptz | | 软删除时间戳 |
| `password_changed_at` | timestamptz | | 最后修改密码时间 |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

**索引**：
- `idx_users_status`：`status` 的部分索引，WHERE `status <> 'DELETED'`
- `idx_users_dept`：`dept_id`
- `idx_users_deleted_at`：`deleted_at`

**关联关系**：
- `userRoles` → 多个 `user_roles`
- `department` → 一个 `departments`（通过 `dept_id`）

### 3.2 部门表（`departments`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | 内部 UUID |
| `parent_id` | uuid | | 自引用，用于树形层级 |
| `name` | varchar(100) | 非空 | 部门名称 |
| `code` | varchar(50) | 唯一 | 业务编码 |
| `ancestors` | varchar(500) | | 物化路径（例如 `dept_001/dept_002`），根节点为 NULL。无需递归 CTE 即可高效查询子树 |
| `sort` | smallint | 非空，默认 0 | 显示排序 |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

**索引**：
- `idx_departments_parent`：`parent_id`
- `idx_departments_ancestors`：`ancestors`

**通过 ancestors 进行子树查询**：
```sql
-- 查询 deptId 及其所有子部门
SELECT id FROM departments
WHERE id = :deptId OR ancestors LIKE :deptId || '/%'
```

### 3.3 角色表（`roles`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | 内部 UUID |
| `name` | varchar(100) | 非空 | 角色显示名称 |
| `code` | varchar(50) | 唯一，非空 | 角色编码（例如 `admin`、`editor`） |
| `description` | text | | |
| `dept_id` | uuid | 非空，外键 → departments.id，ON DELETE CASCADE | **v3.2 新增**。角色所属部门，决定角色的数据可见范围。每个角色必须属于一个部门。删除部门时级联删除其下所有角色 |
| `is_system` | boolean | 非空，默认 false | 系统角色不可删除 |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `sort` | smallint | 非空，默认 0 | |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

> **v3.2 设计决策**：`data_scope_type` 列已移除。角色的数据范围由其 `dept_id` 隐式决定——角色能访问所属部门及其所有子部门的数据。每个角色必须属于一个部门（`dept_id` NOT NULL）。不再需要独立的 `data_scope_type` 枚举（ALL/DEPT/DEPT_AND_SUB/SELF/CUSTOM）。

### 3.4 权限表（`permissions`）— 已合并菜单功能

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | 内部 UUID |
| `code` | varchar(50) | 唯一，非空 | 权限编码（例如 `user:list`） |
| `name` | varchar(100) | 非空 | 权限显示名称 |
| `description` | text | | |
| `type` | permission_type | 非空，默认 'API' | `DIRECTORY` / `PAGE` / `API` / `DATA` |
| `path` | varchar(200) | | DIRECTORY/PAGE 专属：前端路由路径 |
| `icon` | varchar(50) | | DIRECTORY/PAGE 专属：菜单图标 |
| `visible` | boolean | | DIRECTORY/PAGE 专属：菜单可见性 |
| `resource` | varchar(100) | | API/DATA 专属：资源路径 |
| `action` | varchar(50) | | API/DATA 专属：操作 |
| `client_id` | varchar(50) | 外键 → clients.client_id，ON DELETE CASCADE | API 专属：所属 OAuth 客户端 |
| `parent_id` | uuid | | 自引用，用于树形层级 |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `sort` | smallint | 非空，默认 0 | |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

**索引**：
- `idx_permissions_client`：`client_id`
- `idx_permissions_parent`：`parent_id`
- `idx_permissions_type`：`type`

**CHECK 约束**：
```sql
-- DIRECTORY/PAGE 不可有 resource/action/client_id；API/DATA 必有 resource/action
CHECK (
  (type IN ('DIRECTORY','PAGE') AND resource IS NULL AND action IS NULL AND client_id IS NULL)
  OR (type IN ('API','DATA') AND resource IS NOT NULL AND action IS NOT NULL)
)
```

> **v2 变更**：`menus` 表已合并进 `permissions` 表。菜单节点现以 `type = 'DIRECTORY' | 'PAGE'` 存储，字段 `path`/`icon`/`visible` 仅供这两种类型使用。旧 `menu_type` 枚举（`DIRECTORY`/`MENU`/`BUTTON`）已替换为 `permission_type`（`DIRECTORY`/`PAGE`/`API`/`DATA`）。

> **为什么 `client_id` 引用 `clients.client_id`（业务键）而不是 `clients.id`？**
>
> Gateway（Rust/Pingora）和权限注册端点直接消费 `permissions.clientId`，且期望使用业务 `client_id` 值。由于 `clients.client_id` 具有 UNIQUE 约束，参照完整性与引用内部 `id` 等效。这是唯一有意为之的外键例外。

### 3.5 用户-角色关联表（`user_roles`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `user_id` | uuid | 非空，外键 → users.id，ON DELETE CASCADE | |
| `role_id` | uuid | 非空，外键 → roles.id，ON DELETE CASCADE | |
| `created_at` | timestamptz | 非空，默认 now() | |

**唯一索引**：`ux_user_roles_pk` ON `(user_id, role_id)` — 复合主键，无代理 `id`。

**索引**：`idx_user_roles_role` ON `role_id`。

### 3.6 角色-权限关联表（`role_permissions`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `role_id` | uuid | 非空，外键 → roles.id，ON DELETE CASCADE | |
| `permission_id` | uuid | 非空 | |
| `created_at` | timestamptz | 非空，默认 now() | |

**唯一索引**：`ux_role_permissions_pk` ON `(role_id, permission_id)` — 复合主键，无代理 `id`。

**索引**：`idx_role_permissions_permission` ON `permission_id`。

---

## 4. OIDC Provider 域实体

### 4.1 OAuth 客户端表（`clients`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `client_id` | varchar(50) | **主键** | OAuth 2.1 客户端标识符（业务键即 PK，无额外 `id` 列） |
| `name` | varchar(100) | 非空 | 客户端应用名称 |
| `client_secret` | varchar(128) | | OAuth 2.1 客户端密钥（SHA-256 哈希存储；公开客户端可为空） |
| `redirect_uris` | varchar(255)[] | 非空 | 允许的重定向 URI（PostgreSQL 原生文本数组） |
| `scopes` | varchar(200) | 非空，默认 'openid profile email offline_access' | 以空格分隔的 OAuth 范围（符合 RFC 6749） |
| `homepage_url` | varchar(500) | | 客户端首页 |
| `logo_url` | varchar(500) | | 客户端 Logo 图片 URL |
| `access_token_ttl` | integer | 默认 3600 | Access Token 有效期（秒） |
| `refresh_token_ttl` | integer | 默认 604800 | Refresh Token 有效期（秒） |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `is_internal` | boolean | 默认 false | 区分 Portal 内部客户端与第三方，决定 AT audience |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

> **v2 设计决策**：`client_id` 为 PK。消除了旧版的 `id` + `public_id` + `client_id` 三标识符冗余。所有 OAuth 相关表的 FK 统一引用此列。

### 4.2 授权码表（`authorization_codes`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | |
| `code` | varchar(100) | 唯一，非空 | 授权码 |
| `client_id` | varchar(50) | 非空，外键 → clients.client_id，ON DELETE CASCADE | |
| `user_id` | uuid | 非空，外键 → users.id，ON DELETE CASCADE | 资源所有者 |
| `redirect_uri` | varchar(500) | 非空 | 请求中使用的确切重定向 URI |
| `scope` | varchar(200) | 非空 | 请求的权限范围 |
| `state` | varchar(100) | | OAuth state 参数 |
| `nonce` | varchar(100) | | OIDC nonce 参数 |
| `code_challenge` | varchar(100) | | PKCE 代码挑战值（RFC 7636） |
| `code_challenge_method` | code_challenge_method | 默认 'S256' | PKCE 挑战方法 |
| `expires_at` | timestamptz | 非空 | 绝对过期时间（5 分钟） |
| `used` | boolean | 默认 false | 单次使用强制 |
| `created_at` | timestamptz | 非空，默认 now() | |

### 4.3 访问令牌表（`access_tokens`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | |
| `token_hash` | varchar(64) | 唯一，非空 | 访问令牌 SHA-256 哈希（不存明文） |
| `client_id` | varchar(50) | 非空，外键 → clients.client_id，ON DELETE CASCADE | |
| `user_id` | uuid | 非空，外键 → users.id，ON DELETE CASCADE | |
| `scopes` | varchar(200) | 非空 | 已授予的权限范围 |
| `expires_at` | timestamptz | 非空 | |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

**索引**：
- `idx_access_tokens_client`：`client_id`
- `idx_access_tokens_user`：`user_id`

### 4.4 刷新令牌表（`refresh_tokens`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | |
| `token_hash` | varchar(64) | 唯一，非空 | 刷新令牌 SHA-256 哈希（不存明文） |
| `client_id` | varchar(50) | 非空，外键 → clients.client_id，ON DELETE CASCADE | |
| `user_id` | uuid | 非空，外键 → users.id，ON DELETE CASCADE | |
| `scopes` | varchar(200) | 非空 | |
| `revoked` | timestamptz | | 非空表示已撤销（撤销时间戳） |
| `auth_time` | timestamptz | | 原始认证时间 |
| `expires_at` | timestamptz | 非空 | |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

**索引**：
- `idx_refresh_tokens_client`：`client_id`
- `idx_refresh_tokens_user`：`user_id`

### 4.5 用户授权记录表（`consents`）— 🗑️ 已移除

> **v3.x 变更**：`consents` 表已从当前 Schema 中移除，用户授权逻辑已简化。

### 4.6 JWKS 密钥表（`jwks`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | |
| `kid` | varchar(50) | 唯一，非空 | 密钥 ID（与 JWT header.kid 匹配） |
| `algorithm` | varchar(10) | 默认 'ES256' | 签名算法 |
| `public_key` | text | 非空 | 公钥（JWK 格式 JSON） |
| `private_key` | text | 非空 | 私钥（JWK 格式 JSON） |
| `created_at` | timestamptz | 非空，默认 now() | |
| `expires_at` | timestamptz | | 密钥轮换过期时间（90 天） |

> **安全**：JWKS 端点仅返回未过期密钥（`expires_at > now() OR expires_at IS NULL`）。

---

## 5. 审计与日志表

### 5.1 审计日志表（`audit_logs`）

仅追加的操作审计跟踪。**无外键约束** —— 日志必须在实体删除后仍保留。

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | |
| `user_id` | uuid | | 操作用户 ID（无 FK，用户删除后仍保留） |
| `username` | varchar(50) | | 操作用户名（冗余副本，用于日志自包含） |
| `operation` | audit_operation | 非空 | 审计操作类型（枚举） |
| `method` | varchar(10) | | HTTP 方法 |
| `url` | varchar(500) | | 请求 URL |
| `params` | jsonb | | 结构化请求参数（PostgreSQL JSONB） |
| `ip` | inet | | 客户端 IP 地址 |
| `user_agent` | varchar(500) | | |
| `status` | smallint | | HTTP 响应状态码 |
| `duration` | integer | | 请求时长（毫秒） |
| `error_msg` | text | | 失败时的错误消息 |
| `created_at` | timestamptz | 非空，默认 now() | |

**索引**：
- `idx_audit_logs_user`：`user_id`
- `idx_audit_logs_created`：`created_at`
- `idx_audit_logs_operation`：`operation`

**防篡改策略（支撑 J-LOG-003「日志不可篡改、不可删除」）**：
- **仅追加（append-only）**：应用层不提供审计日志的 UPDATE/DELETE 接口；`audit_logs` 仅有 INSERT 路径。
- **数据库权限收口**：生产环境通过 GRANT 仅授予应用 DB 角色对 `audit_logs` / `login_logs` 的 INSERT/SELECT 权限，显式 REVOKE UPDATE/DELETE（部署脚本约束，见 DC-AUDIT-IMMUTABLE）。
- **无外键 + 冗余字段**：`user_id`/`username` 无 FK 且冗余存储，保证用户/实体删除后日志仍完整可读、可审计。
- **完整性校验（推荐增强）**：在高合规场景下可追加行级哈希链（每行存前一行 hash 的累计摘要），任意篡改将破坏链式校验——列为未来增强项。

### 5.2 登录日志表（`login_logs`）

仅追加的登录事件跟踪。**无外键约束** —— 原因同审计日志。

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | |
| `user_id` | uuid | | 操作用户 ID（无 FK） |
| `username` | varchar(50) | 非空 | 操作用户名（冗余副本） |
| `event_type` | login_event | 非空 | 登录事件类型（枚举）：`LOGIN_SUCCESS` / `LOGIN_FAILED` / `LOGOUT` / `TOKEN_REFRESH` / `TOKEN_REFRESH_FAILED` |
| `ip` | inet | | 客户端 IP 地址 |
| `user_agent` | varchar(500) | | |
| `location` | varchar(100) | | 地理位置（如有） |
| `fail_reason` | text | | 登录失败原因 |
| `created_at` | timestamptz | 非空，默认 now() | |

**索引**：
- `idx_login_logs_user`：`user_id`
- `idx_login_logs_created`：`created_at`
- `idx_login_logs_event_type`：`event_type`

### 5.3 访问日志表（`access_logs`）

仅追加的读操作访问日志（GET 敏感数据查看），按月分区保留 180 天。**无外键约束** —— 原因同审计日志。

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | |
| `user_id` | uuid | | 操作用户 ID（无 FK） |
| `username` | varchar(50) | | 操作用户名（冗余副本） |
| `method` | varchar(10) | 非空 | HTTP 方法 |
| `path` | varchar(500) | 非空 | 请求路径 |
| `resource_type` | varchar(50) | | 资源类型（如 users, roles） |
| `resource_id` | varchar(64) | | 资源 ID |
| `ip` | inet | | 客户端 IP 地址 |
| `user_agent` | varchar(500) | | |
| `status` | smallint | | HTTP 响应状态码 |
| `duration` | integer | | 请求时长（毫秒） |
| `created_at` | timestamptz | 非空，默认 now() | |

**索引**：
- `idx_access_logs_user`：`user_id`
- `idx_access_logs_created`：`created_at`
- `idx_access_logs_resource`：`(resource_type, resource_id)`

> **分区策略**：生产环境按月分区（`PARTITION BY RANGE created_at`），由 0004 migration 手动创建分区表，Drizzle schema 仅用于类型推导。

---

## 6. PostgreSQL 枚举定义

| 枚举名称 | 取值 | 使用位置 |
|-----------|--------|---------|
| `user_status` | `ACTIVE`、`DISABLED`、`LOCKED`、`DELETED` | users.status |
| `entity_status` | `ACTIVE`、`DISABLED` | roles、permissions、departments、clients |
| `permission_type` | `DIRECTORY`、`PAGE`、`API`、`DATA` | permissions.type |
| `login_event` | `LOGIN_SUCCESS`、`LOGIN_FAILED`、`LOGOUT`、`TOKEN_REFRESH`、`TOKEN_REFRESH_FAILED` | login_logs.event_type |
| `audit_operation` | `USER_CREATE`、`USER_UPDATE`、`USER_DELETE`、`USER_ROLE_ASSIGN`、`ROLE_CREATE`、`ROLE_UPDATE`、`ROLE_DELETE`、`ROLE_PERMISSION_ASSIGN`、`PERMISSION_CREATE`、`PERMISSION_UPDATE`、`PERMISSION_DELETE`、`DEPARTMENT_CREATE`、`DEPARTMENT_UPDATE`、`DEPARTMENT_DELETE`、`CLIENT_CREATE`、`CLIENT_UPDATE`、`CLIENT_DELETE`、`CLIENT_SECRET_REGENERATE`、`TOKEN_REVOKE` | audit_logs.operation |
| `code_challenge_method` | `S256` | authorization_codes.code_challenge_method |

> **v3.2 已移除的枚举**：`data_scope_type`（`ALL`/`DEPT`/`DEPT_AND_SUB`/`SELF`/`CUSTOM`）、`menu_type`（`DIRECTORY`/`MENU`/`BUTTON`）。

所有枚举值在 `@auth-sso/contracts` 中定义为唯一数据源，并通过 `apps/portal/src/db/schema/enums.ts` 以 `pgEnum` 重新导出。

---

## 7. 外键汇总

| 源表 | 源列 | 目标表 | 目标列 | 删除策略 |
|-------------|---------------|--------------|---------------|-----------|
| `users` | `dept_id` | `departments` | `id` | SET NULL |
| `roles` | `dept_id` | `departments` | `id` | CASCADE |
| `user_roles` | `user_id` | `users` | `id` | CASCADE |
| `user_roles` | `role_id` | `roles` | `id` | CASCADE |
| `role_permissions` | `role_id` | `roles` | `id` | CASCADE |
| `permissions` | `client_id` | `clients` | `client_id` * | CASCADE |
| `permissions` | `parent_id` | `permissions` | `id` | （自引用，migration 手动添加） |
| `authorization_codes` | `client_id` | `clients` | `client_id` * | CASCADE |
| `authorization_codes` | `user_id` | `users` | `id` | CASCADE |
| `access_tokens` | `client_id` | `clients` | `client_id` * | CASCADE |
| `access_tokens` | `user_id` | `users` | `id` | CASCADE |
| `refresh_tokens` | `client_id` | `clients` | `client_id` * | CASCADE |
| `refresh_tokens` | `user_id` | `users` | `id` | CASCADE |

> \* 此四表的 `client_id` 引用 `clients.client_id`（业务键）。`clients.client_id` 具有 UNIQUE 约束，参照完整性与引用内部 `id` 等效。Gateway 和 OAuth 端点直接消费业务 `client_id`。
>
> **v3.2 已移除的表和外键**：`role_data_scopes`（role_id → roles.id, dept_id → departments.id）、`role_clients`（role_id → roles.id, client_id → clients.client_id）。

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
2. **索引**：对 `username`、`client_id`、外键列以及审计表的 `created_at` 建有索引。部分索引用于带过滤条件的查询（如活跃用户）。
3. **树形结构**：部门和权限使用自引用 `parent_id`。部门额外使用 `ancestors` 物化路径，无需递归 CTE 即可高效查询子树。
4. **Drizzle 关联关系**：在 `apps/portal/src/db/schema/relations.ts` 中声明。支持 `db.query.table.findMany({ with: {...} })` 实现嵌套对象加载。复杂报表查询仍使用手动 JOIN。
5. **ID 策略**：所有实体统一使用 `uuid().defaultRandom()` 作为主键。`clients` 表以 `client_id`（varchar 业务键）为主键。外部 API 仅接受 `id`（uuid），不再支持 `public_id`。
6. **共享数据库**：Portal 核心域和 OIDC Provider 域共用同一物理数据库，以保持简单性和参照完整性。
7. **复合主键**：`user_roles` 和 `role_permissions` 关联表使用 `(user_id, role_id)` 和 `(role_id, permission_id)` 作为复合主键（唯一索引），无代理 `id` 列。
