# 数据库设计 - Auth-SSO

版本：v3.5
状态：已发布
最后更新：2026-10-23

> **v3.2 重大变更 — RBAC 权限模型重构**：删除 `data_scope_type` 枚举和 `role_data_scopes`、`role_clients` 两张关联表；角色新增 `dept_id` 字段（FK → `departments.id`），以「角色所属部门」替代独立的数据范围配置。数据访问控制从「dataScopeType 五种分支」简化为「角色部门 ID 列表 + 子树展开」的单一模型（决策见 ADR-002）。
>
> **v3.3 变更 — ADR-006/007/008 清理**：`permissions` 表移除 `resource` 和 `action` 列、移除 `DATA` 类型；`refresh_tokens` 表移除 `client_id` 列（RT 统一为用户级）；权限码格式改为 `{clientId}:{resource}:{action}` 命名空间格式。
>
> **v3.4 变更 — ADR-012/013（2026-09-28/30）**：`access_tokens` 预留表删除（幽灵表清理，introspect 无状态化）；`refresh_tokens` 恢复 `client_id` 绑定（RFC 9700 token family，重放级联撤销收窄为 `(userId, clientId)`）；AT 显式携带 `aud = client_id` + `client_id` claim。
>
> **v3.5 变更 — 全文对照 schema 与迁移校正（2026-10-23）**：①迁移 `0003_email_case_insensitive.sql` + ADR-026：`ux_users_email` → `ux_users_email_ci`（`lower(email)` 部分唯一索引），登录/创建/改邮箱统一走 `EmailSchema` 归一化；②`clients` 表**没有** `is_internal` 列（旧文档错记），`access_token_ttl` / `refresh_token_ttl` 为 NOT NULL 且按 ADR-024 生效并钳制；③补齐漏记的列与索引：`users.password_history` + CHECK、`permissions_type_fields_chk`、`login_logs` 复合索引、`access_logs` 复合主键；④`permissions.parent_id` 外键在 0000 迁移中已为 `ON DELETE CASCADE`；⑤Redis 键空间补全（`portal:user_jti:` / `portal:auth_req:` / `portal:login_fail*`），旧键名 `user:{sub}:perms` 更正为 `portal:user_perms:`；⑥`access_logs` 分区维护脚本路径更正为 `apps/portal/scripts/maintain-access-log-partitions.ts`。依据：`apps/portal/src/db/schema/*.ts`、`apps/portal/drizzle/` 下 0000~0003 四个迁移文件。
>
> **v2 基础架构变更**：全表 `text`→`uuid`/`varchar`、`timestamp`→`timestamptz`、移除 `public_id`、`clients.client_id` 为业务主键、`user_roles`/`role_permissions` 改为复合主键。表定义唯一真相源为 `apps/portal/src/db/schema/*.ts`（按领域拆分：`users.ts` / `org.ts` / `rbac.ts` / `auth.ts` / `logs.ts` + `enums.ts` / `helpers.ts` / `relations.ts` / `index.ts` 聚合导出），DDL 唯一真相源为 `apps/portal/drizzle/*.sql`。

---

## 1. 存储架构

Auth-SSO 采用 PostgreSQL 与 Redis 的混合存储方案。为简化部署、提升效率并保证数据一致性，所有实体均位于**单个物理 PostgreSQL 数据库**中，同时维持严格的**逻辑隔离**。

### 1.1 逻辑数据域
- **Portal 核心域**：包含业务逻辑数据，如用户、组织架构（部门）、审计日志以及 RBAC（角色、权限）。
- **OIDC Provider 域**：包含 OIDC 客户端配置、授权码、活跃令牌以及密钥对（JWKS）。

### 1.2 Redis 键空间

前缀常量唯一真相源：`packages/contracts/src/oidc.ts` 的 `REDIS_KEY_PREFIX`（Portal ↔ Gateway 共享）；各键的详细语义见 §8。

| 键前缀 | 用途 | TTL | 管理方 |
| --- | --- | --- | --- |
| `portal:jti_blocklist:` | JWT jti 紧急撤销黑名单 | 令牌剩余有效期 | Portal BFF（Gateway 也读校验） |
| `portal:user_jti:` | userId → `{jti: exp}` Hash，支持按用户 ID 精确撤销 | 每次写入取该 jti 的剩余 TTL | Portal BFF |
| `portal:user_perms:` | 用户权限上下文缓存 | 3600 秒 ± 300 秒（与 Access Token TTL 对齐） | Portal BFF |
| `portal:auth_req:` | OAuth 授权请求参数暂存（未登录时存，登录后恢复） | 5 分钟 | Portal BFF |
| `portal:login_fail:` | 登录失败计数：账户 × 客户端 IP（ADR-025） | 15 分钟（`BRUTE_FORCE_WINDOW_MINUTES`） | Portal BFF |
| `portal:login_fail_ip:` | 登录失败计数：客户端 IP 总量（ADR-025） | 15 分钟（`BRUTE_FORCE_IP_WINDOW_MINUTES`） | Portal BFF |

---

## 2. 命名约定

- **表名**：复数蛇形命名法（snake_case），例如 `users`、`roles`。
- **列名**：蛇形命名法（snake_case），例如 `dept_id`、`created_at`。
- **主键**：统一 `uuid().defaultRandom()`，对外以 `id`（uuid）暴露，不再使用 `public_id`。两处例外：`clients` 以业务键 `client_id` 为主键（无 `id` 列）；`access_logs` 为分区表，主键为 `(id, created_at)`。
- **外键**：全部引用目标表**主键**。其中 `clients` 的主键即业务键 `client_id`，故 `permissions.client_id`、`authorization_codes.client_id`、`refresh_tokens.client_id` 引用 `clients.client_id`；其余表（`users`、`roles`、`permissions`）的主键是内部 `id`（RT 绑定发放 client 见 ADR-012，RFC 9700 token family）。
- **状态**：用户使用 `user_status` 枚举（`ACTIVE`、`DISABLED`、`LOCKED`、`DELETED`）。其他所有实体使用 `entity_status` 枚举（`ACTIVE`、`DISABLED`）。用户的软删除通过 `status = 'DELETED'` 实现。
- **时间列**：统一 `timestamptz`（`timestamp with timezone`），通过 `createdAtColumn()` / `updatedAtColumn()` helper 构造。

---

## 3. Portal 域实体

### 3.1 用户表（`users`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | 内部 UUID |
| `username` | varchar(50) | 唯一，非空 | 登录用户名（**完整唯一约束**，软删除不释放） |
| `email` | varchar(255) | 部分唯一（见索引） | 邮箱地址（应用层 trim+lower 后落库，ADR-026） |
| `email_verified` | boolean | 非空，默认 false | 邮箱验证标记 |
| `mobile` | varchar(20) | 部分唯一（见索引） | 手机号码 |
| `mobile_verified` | boolean | 非空，默认 false | 手机验证标记 |
| `password_hash` | varchar(128) | | 哈希后的密码 |
| `password_history` | text[] | CHECK `users_password_history_len_chk`：NULL 或 `array_length ≤ 10` | 密码历史（最近 N 条 bcrypt 哈希，按时间倒序，防重用） |
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
- `ux_users_email_ci`：`lower(email)` 的部分唯一索引 WHERE `deleted_at IS NULL`（H-18/ADR-026：**大小写不敏感**；应用层 `EmailSchema` 先 trim+lower，索引是第二道防线，覆盖历史数据/脚本直写）
- `ux_users_mobile`：`mobile` 的部分唯一索引 WHERE `deleted_at IS NULL`

> **邮箱唯一性（ADR-026 / 迁移 `apps/portal/drizzle/0003_email_case_insensitive.sql`）**：旧索引 `ux_users_email`
> 按原值比较，`Admin@Example.com` 与 `admin@example.com` 可注册成两个身份；0003 先把存量归一化为
> `lower(trim(email))`，再删旧索引、建 `ux_users_email_ci`。若归一化后出现重复，索引创建会**显式失败**
> （刻意不静默丢弃身份，需人工合并）。
>
> **已知限制**：`username` 仍是**完整唯一约束**且**大小写敏感**（`citext`/`lower()` 归一尚未实现），
> 故 `Admin` 与 `admin` 理论上可并存；`email` 大小写不敏感已由 `ux_users_email_ci` + `EmailSchema` 落地。

**关联关系**：
- `userRoles` → 多个 `user_roles`
- `department` → 一个 `departments`（通过 `dept_id`）

### 3.2 部门表（`departments`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | 内部 UUID |
| `parent_id` | uuid | | 自引用，用于树形层级（**无外键**：根节点为 NULL；根部门全局唯一，见 ADR-002 增补） |
| `name` | varchar(100) | 非空 | 部门名称 |
| `code` | varchar(50) | 唯一 | 业务编码 |
| `ancestors` | varchar(500) | | 物化路径（**祖先链、不含自身**；根节点为 NULL；一级子部门 = 根 ID）。无需递归 CTE 即可高效查询子树 |
| `sort` | smallint | 非空，默认 0 | 显示排序 |
| `status` | entity_status | 非空，默认 'ACTIVE' | 生命周期门禁：禁用后禁止新建/迁入子部门、用户、角色；**不追溯**既有数据（ADR-002 增补 / 决策 D2） |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

**索引**：
- `idx_departments_parent`：`parent_id`
- `idx_departments_ancestors`：`ancestors`

**通过 ancestors 进行子树查询**（`ancestors` 是完整祖先链，判定必须**逐段**匹配）：
```sql
-- 查询 deptId 及其所有子部门（五条分支，缺一即漏：自身 / 链首直接子 / 链首更深 / 链尾直接子 / 链中）
SELECT id FROM departments
WHERE id = :deptId
   OR ancestors = :deptId
   OR ancestors LIKE :deptId || '/%'
   OR ancestors LIKE '%/' || :deptId
   OR ancestors LIKE '%/' || :deptId || '/%';
```
> 实现见 `apps/portal/src/lib/authz/data-scope.ts`（`expandRoleDeptSubtrees`）。
> 历史教训：只写 `LIKE ':deptId/%'` 会漏掉**直接子部门**（ancestors 恰等于父 ID，无尾斜杠）——
> ADR-014 记录的两次同类缺陷之一；部门移动的级联 SQL 也必须同时带等值分支（审计 H-B-02）。


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
| `code` | varchar(150) | 唯一，非空 | 权限编码（`{clientId}:{resource}:{action}` 命名空间格式，如 `portal:user:list`） |
| `name` | varchar(100) | 非空 | 权限显示名称 |
| `description` | text | | |
| `type` | permission_type | 非空，默认 'API' | `DIRECTORY` / `PAGE` / `API` |
| `path` | varchar(200) | | DIRECTORY/PAGE 专属：前端路由路径 |
| `icon` | varchar(50) | | DIRECTORY/PAGE 专属：菜单图标 |
| `visible` | boolean | | DIRECTORY/PAGE 专属：菜单可见性 |
| `client_id` | varchar(50) | 外键 → clients.client_id，ON DELETE CASCADE；CHECK：DIRECTORY/PAGE 必须为 NULL | 所属 OAuth 客户端（冗余列，code 前缀为首要数据源） |
| `parent_id` | uuid | 自引用 → permissions.id，ON DELETE CASCADE | 树形层级 |
| `status` | entity_status | 非空，默认 'ACTIVE' | |
| `sort` | smallint | 非空，默认 0 | |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

**索引**：
- `idx_permissions_client`：`client_id`
- `idx_permissions_parent`：`parent_id`
- `idx_permissions_type`：`type`

**CHECK 约束** `permissions_type_fields_chk`：`(type IN ('DIRECTORY','PAGE') AND client_id IS NULL) OR type = 'API'`——第一道防线是应用层 Zod discriminatedUnion，DB 约束为第二道防线（`apps/portal/src/db/schema/rbac.ts`）。

> **v2 变更**：`menus` 表已合并进 `permissions` 表。菜单节点现以 `type = 'DIRECTORY' | 'PAGE'` 存储，字段 `path`/`icon`/`visible` 仅供这两种类型使用。
>
> **v3.3 变更（ADR-008）**：删除 `resource` 和 `action` 列，`code` 从 varchar(50) 扩展为 varchar(150)，采用 `{clientId}:{resource}:{action}` 命名空间格式自包含全部含义。`DATA` 类型已废弃（数据范围通过角色-部门绑定实现）。

> **为什么 `client_id` 引用 `clients.client_id`（业务键）而不是 `clients.id`？**
>
> `clients` 表以 `client_id` 为主键（**没有内部 `id` 列**），所有 OAuth 相关表的外键统一引用该业务键。Gateway（Rust/Pingora）和权限注册端点直接消费业务 `client_id` 值，故此处不存在"引用内部 id"的选项。

### 3.5 用户-角色关联表（`user_roles`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `user_id` | uuid | 非空，外键 → users.id，ON DELETE CASCADE | |
| `role_id` | uuid | 非空，外键 → roles.id，ON DELETE CASCADE | |
| `created_at` | timestamptz | 非空，默认 now() | |

**主键**：`user_roles_pkey` ON `(user_id, role_id)` — 复合主键，无代理 `id`。

**索引**：`idx_user_roles_role` ON `role_id`。

### 3.6 角色-权限关联表（`role_permissions`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `role_id` | uuid | 非空，外键 → roles.id，ON DELETE CASCADE | |
| `permission_id` | uuid | 非空，外键 → permissions.id，ON DELETE CASCADE | |
| `created_at` | timestamptz | 非空，默认 now() | |

**主键**：`role_permissions_pkey` ON `(role_id, permission_id)` — 复合主键，无代理 `id`。

**索引**：`idx_role_permissions_permission` ON `permission_id`。

---

## 4. OIDC Provider 域实体

### 4.1 OAuth 客户端表（`clients`）

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `client_id` | varchar(50) | **主键** | OAuth 2.1 客户端标识符（业务键即 PK，无额外 `id` 列） |
| `name` | varchar(100) | 非空 | 客户端应用名称 |
| `client_secret` | varchar(128) | | OAuth 2.1 客户端密钥哈希（**bcrypt，60 字符**；公开客户端不存在——实现强制 secret。兼容读取遗留 SHA-256 hex 哈希） |
| `redirect_uris` | varchar(255)[] | 非空 | 允许的重定向 URI（PostgreSQL 原生文本数组；**精确匹配**） |
| `scopes` | varchar(200) | 非空，默认 'openid profile email offline_access' | 以空格分隔的 OAuth 范围（符合 RFC 6749） |
| `homepage_url` | varchar(500) | | 客户端首页 |
| `logo_url` | varchar(500) | | 客户端 Logo 图片 URL |
| `access_token_ttl` | integer | 非空，默认 3600 | Access Token 有效期（秒）。**生效**：签发时读取并钳制到 `[60, 86400]`；非法/缺失回退 3600（ADR-024） |
| `refresh_token_ttl` | integer | 非空，默认 604800 | Refresh Token 有效期（秒）。**生效**：签发/轮换时读取并钳制到 `[300, 2592000]`；同时用于 RT 行 `expires_at` 与 Cookie `max-age`（ADR-024） |
| `status` | entity_status | 非空，默认 'ACTIVE' | 停用的 client 在 authorize/token 全部拒绝（`resolveActiveClient` 统一校验） |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

> **v2 设计决策**：`client_id` 为 PK。消除了旧版的 `id` + `public_id` + `client_id` 三标识符冗余。所有 OAuth 相关表的 FK 统一引用此列。
>
> **2026-10-23 校正**：本表**没有 `is_internal` 列**（schema 与全部迁移均无该列，旧文档将其列为"历史字段"属错记）。
> 两种 TTL 列自 v3 起就存在但**签发实现从未读取**（死配置，审计 H-16）；ADR-024 落地后生效并钳制。
> `portal` 自身 client 对管理面只读（轮换/禁用/注销会被 `guardPortalSelfClient` 拒绝，否则全站无法登录）。

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

### 4.3 访问令牌表（`access_tokens`）— 🗑️ 已移除

> **v3.4 变更（ADR-012，2026-09-28）**：预留表删除——无编译期隔离的"预留表"被三条消费链路当真表使用（introspect 恒空数据、管理端撤销为静默 no-op）。Access Token 为无状态 JWT，紧急撤销走 Redis jti 黑名单（ADR-004），introspect 无状态化（RFC 7662）。

### 4.4 刷新令牌表（`refresh_tokens`）

> **v3.4 变更（ADR-012，2026-09-28）**：恢复 `client_id` 列（v3.3 曾按 ADR-006 移除）。RT 绑定发放 client（RFC 9700 token family）：Gateway SSO 会话记 `portal`，直连 RP 记各自 client；重放检测级联撤销范围 = `(userId, clientId)`，不再横扫用户全部会话。

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 主键，defaultRandom() | |
| `token_hash` | varchar(64) | 唯一，非空 | 刷新令牌 SHA-256 哈希（不存明文；列名保留历史名称） |
| `user_id` | uuid | 非空，外键 → users.id，ON DELETE CASCADE | |
| `client_id` | varchar(50) | 非空，外键 → clients.client_id，ON DELETE CASCADE | 发放该 RT 的 OAuth Client |
| `scopes` | varchar(200) | 非空 | |
| `revoked` | timestamptz | | 非空表示已撤销（撤销时间戳） |
| `auth_time` | timestamptz | | 原始认证时间 |
| `expires_at` | timestamptz | 非空 | 绝对过期时间 = 签发时刻 + 该 client 的 `refresh_token_ttl`（钳制到 `[300, 2592000]` 秒，ADR-024） |
| `created_at` | timestamptz | 非空，默认 now() | |
| `updated_at` | timestamptz | 非空，默认 now()，自动更新 | |

> **per-client TTL（ADR-024，2026-10-23 生效）**：`expires_at` **不再**取全局常量 `TOKEN_TTL.REFRESH_TOKEN`，
> 而是取**发放该 RT 的 client 行**的 `clients.refresh_token_ttl`，经 `clampTokenTtl()`（`apps/portal/src/lib/auth/token.ts`）
> 钳制到 `[300, 2592000]` 秒；缺失/非数字/≤0 回退默认 604800（7 天）。三条路径同源：
> 授权码兑换（`lib/auth/oauth-grant.ts`）、Refresh Token 轮换（`token.ts` `rotateRefreshToken`，事务内读 client 行）、
> Portal 自身静默续签（`app/api/auth/refresh/route.ts` Cookie `maxAge` 用 `result.refreshExpiresIn`）。
> 同一值保证 `expires_in`、JWT `exp`、本表 `expires_at`、Cookie `max-age` **四处同源**。

**索引**：
- `idx_refresh_tokens_user`：`user_id`
- `idx_refresh_tokens_client`：`client_id`（按 client 撤销/列表查询）
- `idx_refresh_tokens_expires`：`expires_at`

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
- `idx_login_logs_user_event_created`：`(user_id, event_type, created_at)` —— 暴力破解防护 Redis 故障回退查询（ADR-025：按 `userId` + `event_type` + 时间窗统计失败次数）

> **保留期与分区**：本表**不是分区表**（schema `apps/portal/src/db/schema/logs.ts` 普通 `pgTable`），
> append-only 永久保留；180 天保留期只适用于 `access_logs`。

### 5.3 访问日志表（`access_logs`）

仅追加的读操作访问日志（GET 敏感数据查看），按月分区保留 180 天。**无外键约束** —— 原因同审计日志。

| 列名 | 类型 | 约束 | 说明 |
|--------|------|------------|--------|
| `id` | uuid | 非空，defaultRandom()（**非唯一**） | 与 `created_at` 组成复合主键（分区表主键必须含分区键） |
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
| `created_at` | timestamptz | 非空，默认 now() | 分区键 |

**主键 / 索引**：
- `access_logs_pkey`：`(id, created_at)` 复合主键（`PARTITION BY RANGE (created_at)` 的硬性要求）
- `idx_access_logs_user`：`user_id`
- `idx_access_logs_created`：`created_at`
- `idx_access_logs_resource`：`(resource_type, resource_id)`

> **分区策略**：按月分区（`PARTITION BY RANGE (created_at)`，**0000 初始迁移即建为分区表**；该迁移用 `DO $$` 块预建当月+次月两个分区，`created_at` 落在这两个分区之外会无法插入）。分区结构只在 DDL 中定义，Drizzle schema 仅用于类型推导。
> 分区 `access_logs_YYYY_MM` 的创建与回收由 `apps/portal/scripts/maintain-access-log-partitions.ts` 负责
> （入口 `pnpm --filter @auth-sso/portal db:maintain-partitions`）：**预创建当月及次月** 2 个分区，
> 并 `DROP` 名早于「现在 − 180 天」所在月的分区；幂等（`CREATE TABLE IF NOT EXISTS` + 查 `pg_inherits`）。
> 该脚本只提供能力，**调度由部署/运维平台按月发起**，GitHub Actions 不负责生产库运维。

---

## 6. PostgreSQL 枚举定义

| 枚举名称 | 取值 | 使用位置 |
|-----------|--------|---------|
| `user_status` | `ACTIVE`、`DISABLED`、`LOCKED`、`DELETED` | users.status |
| `entity_status` | `ACTIVE`、`DISABLED` | roles、permissions、departments、clients |
| `permission_type` | `DIRECTORY`、`PAGE`、`API` | permissions.type |
| `login_event` | `LOGIN_SUCCESS`、`LOGIN_FAILED`、`LOGOUT`、`TOKEN_REFRESH`、`TOKEN_REFRESH_FAILED` | login_logs.event_type |
| `audit_operation` | 18 种操作（`USER_CREATE`、`USER_UPDATE`、`USER_DELETE`、`USER_ROLE_ASSIGN`、`ROLE_CREATE`、`ROLE_UPDATE`、`ROLE_DELETE`、`ROLE_PERMISSION_ASSIGN`、`PERMISSION_CREATE`、`PERMISSION_UPDATE`、`PERMISSION_DELETE`、`DEPARTMENT_CREATE`、`DEPARTMENT_UPDATE`、`DEPARTMENT_DELETE`、`CLIENT_CREATE`、`CLIENT_UPDATE`、`CLIENT_DELETE`、`CLIENT_SECRET_REGENERATE`、`TOKEN_REVOKE`） | audit_logs.operation |
| `code_challenge_method` | `S256` | authorization_codes.code_challenge_method |

> **已移除的枚举**：`data_scope_type`（`ALL`/`DEPT`/`DEPT_AND_SUB`/`SELF`/`CUSTOM`，v3.2）、`menu_type`（`DIRECTORY`/`MENU`/`BUTTON`，v2）、`DATA` 权限类型（v3.3）。

所有枚举值在 `@auth-sso/contracts` 中定义为唯一数据源（`USER_STATUS_VALUES` / `ENTITY_STATUS_VALUES` / `PERMISSION_TYPE_VALUES` / `LOGIN_EVENT_VALUES` / `AUDIT_OPERATION_VALUES` / `CODE_CHALLENGE_METHODS_SUPPORTED`），并通过 `apps/portal/src/db/schema/enums.ts` 以 `pgEnum` 重新导出，禁止手写字面量。

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
| `permissions` | `client_id` | `clients` | `client_id` | CASCADE |
| `permissions` | `parent_id` | `permissions` | `id` | CASCADE（自引用） |
| `authorization_codes` | `client_id` | `clients` | `client_id` | CASCADE |
| `authorization_codes` | `user_id` | `users` | `id` | CASCADE |
| `refresh_tokens` | `user_id` | `users` | `id` | CASCADE |
| `refresh_tokens` | `client_id` | `clients` | `client_id` | CASCADE |

> `clients` 表以 `client_id` 为主键（无内部 `id` 列），故引用它的三张表填 `clients.client_id` 是引用**主键**，不是例外。
> `departments.parent_id`、`audit_logs.*`、`login_logs.*`、`access_logs.*` **无外键**（部门树自引用不建 FK；日志表为 append-only / 分区表，不建 FK）。
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
    { "id": "role_1", "code": "admin", "name": "Administrator" }
  ],
  "permissions": ["portal:user:list", "portal:user:create"],
  "deptIds": ["<角色 A 的 dept_id>", "<角色 B 的 dept_id>"]
}
```
**TTL**：3600 秒 ± 300 秒随机抖动（与 Access Token TTL 对齐）。
**用途**：缓存用户的角色/权限上下文，避免每次 API 请求重复查询数据库。在令牌签发时主动预填充（`cacheUserPermissionContext`）。Redis 故障时降级为直接数据库查询（ADR-011/018）。

> **v3.2 变更（2026-10-23 口径更正，决策 D1）**：`deptIds` = 用户所有 ACTIVE 角色的
> `roles.dept_id` **原始值列表，未展开子树**。子树展开的唯一实现是 Portal 内的
> `lib/authz/data-scope.ts`（ADR-014 门面，按请求实时计算）；在缓存里展开会制造第二份实现，
> 并在部门移动时产生真正的陈旧。**消费方若需要"可见部门集合"，必须自行展开或调用 Portal 授权接口。**
> 另：`roles[]` 元素只含 `{id, code, name}`，不含 `deptId`。

> **`:null` 与 `:unavailable` 两个短 TTL 标记**（防穿透，ADR-018）：
> - `portal:user_perms:{userId}:null`（60s）= 用户不存在（否决性）；
> - `portal:user_perms:{userId}:unavailable`（5s）= DB 瞬时故障（缓存性，不构成拒绝依据）。

### 8.3 其他 Portal 键

| 键 | 用途 | TTL |
| --- | --- | --- |
| `portal:user_jti:{userId}` | Hash `{jti → exp}`：管理员按用户 ID 撤销 AT 时据此精确清除，保留每个 jti 的过期时间（`lib/session/revoke.ts` 的 `trackUserJti`） | 随每次写入取该 jti 的剩余 TTL |
| `portal:auth_req:{sessionId}` | 授权请求暂存：authorize 未登录时存 OAuth 参数（含 ADR-023 的 `binding`），登录后恢复 | 5 分钟（300s） |
| `portal:login_fail:{userId}:{ip}` | 账户 × 客户端 IP 登录失败计数（ADR-025）；5 次 → 423 `AUTH_SSO_2004` | 15 分钟（`BRUTE_FORCE_WINDOW_MINUTES`） |
| `portal:login_fail_ip:{ip}` | 客户端 IP 总失败计数（ADR-025）；20 次 → 429 `AUTH_SSO_1008` | 15 分钟（`BRUTE_FORCE_IP_WINDOW_MINUTES`） |

> 前缀常量唯一真相源是 `packages/contracts/src/oidc.ts` 的 `REDIS_KEY_PREFIX`；阈值与窗口均可用环境变量覆盖。


---

## 9. 实现说明

1. **软删除**：用户使用 `status = 'DELETED'`（同时写 `deleted_at`，释放邮箱/手机号部分唯一索引）。其他所有实体使用 `status = 'DISABLED'`（不实现硬删除——采用基于状态的生命周期管理）。**部门 `DISABLED` 是生命周期门禁、不追溯既有数据**（ADR-002 增补）。
2. **索引**：对 `username`、外键列以及日志表的 `created_at` 建有索引；`clients` 以 `client_id` 为主键（自带唯一）。部分索引用于带过滤条件的查询（活跃用户、软删除后释放邮箱/手机号）。
3. **树形结构**：部门和权限使用自引用 `parent_id`。部门额外使用 `ancestors` 物化路径（父链、不含自身），无需递归 CTE 即可高效查询子树；**子树判定必须逐段匹配五条分支**（见 §3.2）。
4. **Drizzle 关联关系**：在 `apps/portal/src/db/schema/relations.ts` 中声明。支持 `db.query.table.findMany({ with: {...} })` 实现嵌套对象加载。复杂报表查询仍使用手动 JOIN。
5. **ID 策略**：所有实体统一使用 `uuid().defaultRandom()` 作为主键（`access_logs` 例外：`(id, created_at)` 复合主键）。`clients` 表以 `client_id`（varchar 业务键）为主键。外部 API 仅接受 `id`（uuid），不再支持 `public_id`。
6. **共享数据库**：Portal 核心域和 OIDC Provider 域共用同一物理数据库，以保持简单性和参照完整性。
7. **审计日志不可篡改**：`audit_logs` / `login_logs` 仅 INSERT（应用层无 UPDATE/DELETE 接口；生产 DB 角色建议 REVOKE UPDATE/DELETE）。`access_logs` 按月分区、保留 180 天，分区维护脚本为 `apps/portal/scripts/maintain-access-log-partitions.ts`（详见 §5.3）。
8. **复合主键**：`user_roles` 和 `role_permissions` 关联表使用 `(user_id, role_id)` 和 `(role_id, permission_id)` 作为复合主键（`user_roles_pkey` / `role_permissions_pkey`），无代理 `id` 列。
