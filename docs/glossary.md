# Auth-SSO 领域术语表 (Glossary)

> 本文件记录 Auth-SSO 系统的核心领域概念、有界上下文划分及术语定义。
> 生成日期: 2026-07-15

---

## 有界上下文 (Bounded Contexts)

```
┌─────────────────────────────────────────────────────┐
│  Auth-SSO 系统                                       │
│                                                     │
│  ┌───────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ Identity  │  │ Authorization│  │AuthN/OAuth  │  │
│  │ 身份管理   │  │   授权管理    │  │ 认证/OAuth  │  │
│  │           │  │              │  │             │  │
│  │ User      │  │ Role         │  │ Session     │  │
│  │ Department│  │ Permission   │  │ Client      │  │
│  │           │  │              │  │ JWT/JWKS    │  │
│  └───────────┘  └──────────────┘  │ PKCE        │  │
│                                     └─────────────┘  │
│  ┌──────────────────────────────┐                    │
│  │ Audit & Compliance           │                    │
│  │ 审计与合规                    │                    │
│  │                              │                    │
│  │ AuditLog / LoginLog          │                    │
│  │ AccessLog                    │                    │
│  └──────────────────────────────┘                    │
│                                                     │
│  ┌──────────────────────────────┐                    │
│  │ Gateway (边缘安全)            │                    │
│  │ JWT 离线验签 / OAuth Client  │                    │
│  │ HMAC 信任路径 / 零信任清洗    │                    │
│  └──────────────────────────────┘                    │
└─────────────────────────────────────────────────────┘
```

---

## Identity — 身份管理

### User（用户）
系统中最核心的实体，代表一个可登录的自然人。

| 属性 | 说明 |
|------|------|
| `id` | UUID 主键 |
| `username` | 登录名，全局唯一 |
| `email` / `mobile` | 联系方式，条件唯一（已删除用户释放） |
| `password_hash` | bcrypt cost=12 哈希 |
| `password_history` | 密码历史倒序数组（防重用） |
| `status` | `ACTIVE` / `DISABLED` / `LOCKED` / `DELETED` |
| `dept_id` | 所属部门（可空） |
| `deleted_at` | 软删除时间戳（合规保留，不可恢复） |

**生命周期**：`ACTIVE` → 管理员禁用 → `DISABLED` → 暴力破解锁定 → `LOCKED` → 软删除 → `DELETED`。

**废弃属性**：-（无）

### Department（部门）
组织树节点，支持自引用父子关系。

| 属性 | 说明 |
|------|------|
| `id` | UUID 主键 |
| `parent_id` | 父部门 ID（NULL = 根节点） |
| `name` | 部门名称 |
| `code` | 部门编码（唯一） |
| `ancestors` | 物化路径（如 `dept_A/dept_B`），用于子树查询 |
| `status` | `ACTIVE` / `DISABLED` |

**约束**：
- 根部门不可删除（`CANNOT_DELETE_ROOT`）
- 有子部门的不可删除（`DEPARTMENT_HAS_CHILDREN`）
- 有用户的不可删除（`DEPARTMENT_HAS_USERS`）
- 不可移动到自己的子节点（`CANNOT_MOVE_TO_CHILD`）

**废弃属性**：-（无）

---

## Authorization — 授权管理

### Role（角色）
RBAC 权限载体，必须属于一个部门。

| 属性 | 说明 |
|------|------|
| `id` | UUID 主键 |
| `name` | 角色名称 |
| `code` | 角色编码（全局唯一） |
| `dept_id` | 归属部门（**NOT NULL**，数据范围来源） |
| `is_system` | 系统预置角色（不可删除/不可修改 code） |
| `status` | `ACTIVE` / `DISABLED` |

**数据范围语义**：角色归属部门 + 该部门全部子部门 = 拥有该角色的用户可访问的组织范围。

**约束**：
- 不存在"系统角色"可以绕过 RBAC 模型的概念。`is_system` 仅标记不可删除/不可修改。
- 不存在跨部门角色。跨部门访问通过赋予用户多个角色实现。
- `ADMIN_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN']` 是系统预置，管理员绕过菜单可见性检查。

**废弃属性**：v3.1 的 `data_scope_type`（已移除）、`role_clients`（已移除）、`role_data_scopes`（已移除）。

### Permission（权限）
RBAC 最小授权单元，统一树结构（合并旧 menus 表）。

| 属性 | 说明 |
|------|------|
| `id` | UUID 主键 |
| `code` | 权限码（全局唯一，如 `user:create`、`menu:dashboard`） |
| `name` | 显示名称 |
| `type` | `DIRECTORY` / `PAGE` / `API` |
| `parent_id` | 父节点（树结构） |
| `path` | 前端路由路径（DIRECTORY/PAGE 专属） |
| `icon` | 菜单图标（DIRECTORY/PAGE 专属） |
| `visible` | 菜单可见性（DIRECTORY/PAGE 专属） |
| `resource` | 资源标识（API 专属） |
| `action` | 操作类型（API 专属） |
| `client_id` | OAuth Client 关联（API 入选） |

**三种 Type 语义**：

| Type | 鉴权参与 | 用途 |
|------|----------|------|
| `DIRECTORY` | 否 | 菜单分组折叠节点（如 `dir:用户管理`） |
| `PAGE` | **是**（通过 `role_permissions` 分配） | 菜单/页面节点（如 `menu:users`） |
| `API` | **是**（通过 `role_permissions` 分配） | 后端权限码（如 `user:create`） |

**菜单可见性算法**：用户拥有某 PAGE 节点下任何子 API 权限 → 该 PAGE 及其 DIR 父节点在菜单中可见。

**废弃属性**：`DATA` type（v3.1 遗留，待清理）。

### UserRole（用户-角色关联）
M:N 关联表，复合主键 `(user_id, role_id)`。

### RolePermission（角色-权限关联）
M:N 关联表，复合主键 `(role_id, permission_id)`。

---

## Authentication & OAuth — 认证与 OAuth

### Client（OAuth 2.1 客户端）
代表接入 SSO 的应用。

| 属性 | 说明 |
|------|------|
| `client_id` | 业务标识（主键，如 `portal`、`demo_app`） |
| `client_secret` | bcrypt 哈希存储 |
| `redirect_uris` | 允许的回调地址数组 |
| `scopes` | 授权范围（默认 `openid profile email offline_access`） |
| `access_token_ttl` / `refresh_token_ttl` | token 有效期 |
| `is_internal` | Portal 自身客户端（不验证 secret） |

**Portal 自身**：`client_id = "portal"`、`is_internal = true`，JWT aud claim = `"portal-client"`。

**废弃属性**：-（无）

### AuthorizationCode（授权码）
OAuth 2.1 authorization_code grant 的一次性授权码。一次性使用（`used` 标记），支持 PKCE S256。

| 字段 | 说明 |
|------|------|
| `code` | 唯一授权码 |
| `code_challenge` / `code_challenge_method` | PKCE 参数 |
| `expires_at` / `used` | 过期与防重放 |

### RefreshToken（刷新令牌）
长期有效的 refresh_token，SHA-256 hash 存储（`token_hash`），支持 rotation + revocation（`revoked` 时间戳标记）。

### JWKS（JSON Web Key Set）
ES256 密钥对存储。

| 字段 | 说明 |
|------|------|
| `kid` | 密钥 ID（JWT header 中的 `kid` claim 对应该字段） |
| `public_key` / `private_key` | PEM 格式密钥对 |
| `expires_at` | 过期时间 |
| `algorithm` | 固定 `ES256` |

**轮换策略**：访问时检查 `expires_at`，过期自动生成新密钥对。Gateway 定时拉取 JWKS 公钥缓存。

### Session（会话）
用户登录态。基于无状态 JWT（Access Token）+ Redis jti 黑名单实现撤销。

| 概念 | 存储 | 说明 |
|------|------|------|
| Access Token (AT) | Cookie `portal_jwt_token` | ES256 JWT，1h 有效期 |
| Refresh Token (RT) | Cookie `portal_refresh_token` | Opaque token，7d 有效期 |
| jti 黑名单 | Redis `portal:jti_blocklist:{jti}` | 紧急撤销，AT 过期前强制失效 |
| 登录会话 | Cookie `login_session` | 临时 token，5min TTL |

**废弃属性**：`access_tokens` 表（预留，当前不使用）。

### PKCE (Proof Key for Code Exchange)
OAuth 2.1 强制安全机制，防止授权码拦截攻击。

Gateway 端使用 CSPRNG 生成 32 字节 `code_verifier`，SHA-256 计算 `code_challenge`。

---

## Audit & Compliance — 审计与合规

### AuditLog（审计日志）
Append-only 写操作记录，**无 FK 约束**（user_id/username 冗余，确保用户删除后日志可读）。

| 操作枚举（19 种） | 说明 |
|------|------|
| `USER_CREATE/UPDATE/DELETE` | 用户 CRUD |
| `USER_ROLE_ASSIGN` | 用户-角色分配 |
| `ROLE_CREATE/UPDATE/DELETE` | 角色 CRUD |
| `ROLE_PERMISSION_ASSIGN` | 角色-权限分配 |
| `PERMISSION_CREATE/UPDATE/DELETE` | 权限 CRUD |
| `DEPARTMENT_CREATE/UPDATE/DELETE` | 部门 CRUD |
| `CLIENT_CREATE/UPDATE/DELETE` | Client CRUD |
| `CLIENT_SECRET_REGENERATE` | Client Secret 轮换 |
| `TOKEN_REVOKE` | Token 撤销 |

### LoginLog（登录日志）
Append-only 登录事件记录。

| 事件枚举（5 种） | 说明 |
|------|------|
| `LOGIN_SUCCESS` | 登录成功 |
| `LOGIN_FAILED` | 登录失败（含 fail_reason） |
| `LOGOUT` | 登出 |
| `TOKEN_REFRESH` | Token 续签成功 |
| `TOKEN_REFRESH_FAILED` | Token 续签失败 |

### AccessLog（访问日志）
读操作访问记录，按月分区，保留 180 天。

---

## Gateway (Rust) — 边缘安全

| 术语 | 说明 |
|------|------|
| **离线验签** | Gateway 本地缓存 JWKS 公钥，不回调 Portal 做 JWT 验证 |
| **零信任身份头清洗** | 剥离客户端所有 `X-` 前缀头 + `Authorization`，Gateway 权威注入 |
| **HMAC 信任路径** | `SHA-256(secret, "timestamp:user_id:jti")` → `X-Gateway-Signature` 头 |
| **Path Class** | 路径分类：Protected / Static / Public / Microservice |
| **Cookie 重写** | 按 Path Class 剥离/替换/透传 Cookie |
| **续签去重** | Redis SET NX EX 30s 防并发续签 |

---

## 通用概念

| 术语 | 说明 |
|------|------|
| **有界上下文 (BC)** | DDD 术语，系统内一个独立领域模型的边界。当前分为 Identity、Authorization、AuthN/OAuth、Audit、Gateway 5 个 BC |
| **Server Action** | Next.js 16 的 `"use server"` 函数，用于内部页面的写操作（替代 REST API） |
| **data.ts** | Next.js 16 Cache Component 读模型，使用 `"use cache"` + `cacheLife()` + `cacheTag()` |
| **actions.ts** | Server Actions 写模型，包含 `withAuth()` 包装的 `db.transaction()` |
| **Domain 层** | 纯 TypeScript 函数，零框架依赖，禁止 `import "next/*"` 或 Drizzle |
| **DomainError** | 领域错误基类，子类化后通过 `mapDomainError()` 统一映射 HTTP |
| **`@auth-sso/contracts`** | 共享包：枚举值、错误码、权限码、OIDC 常量的唯一真相源 |
| **`@auth-sso/config`** | 共享包：Zod env 校验 + URL 推导 |

---

## 废弃/待清理概念

| 概念 | 状态 | 替代方案 |
|------|------|----------|
| `DATA` 权限类型 | 废弃，待清理 | ADR-002：数据范围通过角色-部门绑定实现 |
| `access_tokens` 表 | 预留，不使用 | ADR-004：JWT 无状态 + Redis jti 黑名单 |
| `menus` 表 (v2) | 已合并至 `permissions` | ADR-001：统一权限树 |
| `data_scope_type` (v3.1) | 已移除 | ADR-002：角色-部门绑定 |
| `role_data_scopes` (v3.1) | 已移除 | ADR-002 |
| `role_clients` (v3.1) | 已移除 | 权限 OIDC 准入通过 `permissions.client_id` |

---

## 相关文档

- `docs/adr/ADR-001-unified-permission-tree.md`
- `docs/adr/ADR-002-role-department-binding.md`
- `docs/adr/ADR-003-gateway-as-oauth-client.md`
- `docs/adr/ADR-004-stateless-jwt-redis-blacklist.md`
- `docs/adr/ADR-005-three-layer-security-model.md`
- `docs/spec/ARCHITECTURE.md`
- `docs/spec/DATABASE.md`
- `docs/spec/RBAC_MODEL_REDESIGN.md`
