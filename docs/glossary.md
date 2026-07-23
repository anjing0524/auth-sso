# Auth-SSO 领域术语表 (Glossary)

> 本文件记录 Auth-SSO 系统的核心领域概念、有界上下文划分及术语定义。
> 最后更新: 2026-07-23 (ADR-006/007/008/009 全量实现)

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
│  │ JWT 离线验签 / 身份注入       │                    │
│  │ HMAC 信任路径 / 零信任清洗    │                    │
│  │ ❌ 不管鉴权（ADR-007）        │                    │
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
| `dept_id` | 所属部门（不参与鉴权，创建时必填的归属信息） |
| `deleted_at` | 软删除时间戳（合规保留，不可恢复） |

**生命周期**：`ACTIVE` → 管理员禁用 → `DISABLED` → 暴力破解锁定 → `LOCKED` → 软删除 → `DELETED`。

### Department（部门）
OBAC 模型中 Role 的命名空间/分组容器，组织树节点。

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

### OBAC 模型
Organization-Based Access Control。Department 是 Role 的命名空间容器，角色在部门下创建，用户通过被赋予多个角色获取跨部门权限。**不存在跨部门角色**——跨部门访问通过给用户分配多个角色实现。

### Role（角色）
RBAC 权限载体，必须属于一个部门（OBAC 分组容器）。

| 属性 | 说明 |
|------|------|
| `id` | UUID 主键 |
| `name` | 角色名称 |
| `code` | 角色编码（全局唯一） |
| `dept_id` | 归属部门（**NOT NULL**，OBAC namespace + 数据范围来源） |
| `is_system` | 系统预置角色（不可删除/不可修改 code） |
| `status` | `ACTIVE` / `DISABLED` |

**数据范围语义**：用户的数据访问范围 = 所有被分配角色的 `dept_id` 子树并集。

**约束**：
- `ADMIN_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN']` 是系统预置，管理员绕过菜单可见性检查
- `is_system` 仅标记不可删除/不可修改，非绕过鉴权的概念

### Permission（权限）
RBAC 最小授权单元，统一树结构。权限码采用 `{clientId}:{resource}:{action}` 命名空间格式（ADR-008）。

| 属性 | 说明 |
|------|------|
| `id` | UUID 主键 |
| `code` | 权限码（全局唯一，如 `portal:user:create`、`portal:menu:users`） |
| `name` | 显示名称 |
| `type` | `DIRECTORY` / `PAGE` / `API` |
| `parent_id` | 父节点（全局一棵权限树） |
| `path` | 前端路由路径（DIRECTORY/PAGE 专属） |
| `icon` | 菜单图标（DIRECTORY/PAGE 专属） |
| `visible` | 菜单可见性（DIRECTORY/PAGE 专属） |
| `client_id` | OAuth Client FK（冗余列，用于索引查询；code 前缀为首要数据源） |
| `sort` | smallint 排序 |

**三种 Type 语义**：

| Type | 鉴权参与 | 用途 |
|------|----------|------|
| `DIRECTORY` | 否 | 菜单分组折叠节点 |
| `PAGE` | **是**（通过 `role_permissions` 分配） | 菜单/页面节点 |
| `API` | **是**（通过 `role_permissions` 分配） | 后端权限码 |

**菜单可见性算法**：仅遍历 `type IN ('DIRECTORY', 'PAGE')` 的节点，按 `sort` 排序递归构建树。用户拥有某 PAGE 的 code 权限 → 该 PAGE 可见；无权限但子树有可见子节点 → 保留为不可点击容器。

**废弃属性**：
- ~~`resource`~~ — 已删除（ADR-008），code 自包含全部信息
- ~~`action`~~ — 已删除（ADR-008），code 自包含全部信息
- ~~`DATA` type~~ — v3.1 遗留，待清理

### UserRole（用户-角色关联）
M:N 关联表，复合主键 `(user_id, role_id)`。

### RolePermission（角色-权限关联）
M:N 关联表，复合主键 `(role_id, permission_id)`。

---

## Authentication & OAuth — 认证与 OAuth

### Client（OAuth 2.1 客户端）
权限的容器（ADR-008）。代表接入 SSO 的应用，Client 下注册一组 permissions（页面 + API），通过角色分配给用户。

| 属性 | 说明 |
|------|------|
| `client_id` | 业务标识（主键，如 `portal`、`demo_app`） |
| `client_secret` | bcrypt 哈希存储 |
| `redirect_uris` | 允许的回调地址数组 |
| `scopes` | 授权范围（默认 `openid profile email offline_access`） |
| `access_token_ttl` / `refresh_token_ttl` | token 有效期 |
| `is_internal` | Portal 自身客户端（不验证 secret） |

**Portal 自身**：`client_id = "portal"`、`is_internal = true`。

### AuthorizationCode（授权码）
OAuth 2.1 authorization_code grant 的一次性授权码。支持 PKCE S256。5min TTL，一次性使用（`used` 标记）。

### RefreshToken（刷新令牌）
用户级别的长期有效 refresh_token（ADR-006 决定去 clientId 作用域）。

| 属性 | 说明 |
|------|------|
| `token_hash` | SHA-256 哈希存储（明文不落库） |
| `user_id` | 所属用户 |
| `scopes` | 授权范围 |
| `revoked` | 非空 = 已撤销（时间戳） |
| `expires_at` | 过期时间（7 天） |

**Rotation**：刷旧 RT → 撤销旧 RT + 签发新 RT + 新 AT（同一 DB 事务）。
**复用检测**：检测到已撤销 RT 被重复使用 → 级联撤销该用户**所有** RT → 拒绝。

**废弃属性**：
- ~~`client_id`~~ — 已删除（ADR-006），RT 统一为用户级

### JWKS（JSON Web Key Set）
ES256 密钥对存储。

| 字段 | 说明 |
|------|------|
| `kid` | 密钥 ID |
| `public_key` / `private_key` | JWK 格式密钥对 |
| `expires_at` | 过期时间（90 天轮换） |
| `algorithm` | 固定 `ES256` |

### Session（会话）
用户登录态。基于**最小化无状态 JWT**（ADR-006）+ Redis jti 黑名单实现撤销。

| 概念 | 存储 | 说明 |
|------|------|------|
| Access Token (AT) | Cookie `portal_jwt_token` | ES256 JWT，仅含 `sub` + `jti` + 标准 claims，1h 有效期 |
| Refresh Token (RT) | Cookie `portal_refresh_token` | Opaque token，用户级别，7d 有效期 |
| jti 黑名单 | Redis `portal:jti_blocklist:{jti}` | 紧急撤销 |
| 用户权限上下文 | Redis `user:{sub}:perms` | `{roles[], permissions[], deptIds[]}`，子应用自取鉴权 |

**JWT Claims（最小化后）**：
```typescript
{
  sub: string;        // 用户 ID
  iss: "auth-sso";    // 体系级签发者
  aud: "auth-sso";    // 体系级受众
  jti: string;
  iat: number;
  exp: number;
}
```

### PKCE (Proof Key for Code Exchange)
OAuth 2.1 强制安全机制。Gateway 端使用 CSPRNG 生成 32 字节 `code_verifier`，SHA-256 计算 `code_challenge`。

---

## Audit & Compliance — 审计与合规

### AuditLog（审计日志）
Append-only 写操作记录，**无 FK 约束**（确保用户/实体删除后日志可读）。

18 种操作类型：`USER_CREATE/UPDATE/DELETE`, `USER_ROLE_ASSIGN`, `ROLE_CREATE/UPDATE/DELETE`, `ROLE_PERMISSION_ASSIGN`, `PERMISSION_CREATE/UPDATE/DELETE`, `DEPARTMENT_CREATE/UPDATE/DELETE`, `CLIENT_CREATE/UPDATE/DELETE`, `CLIENT_SECRET_REGENERATE`, `TOKEN_REVOKE`

### LoginLog（登录日志）
5 种事件：`LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `TOKEN_REFRESH`, `TOKEN_REFRESH_FAILED`

### AccessLog（访问日志）
读操作访问记录，按月分区，保留 180 天。

---

## Gateway (Rust) — 边缘安全（ADR-007/009 职责定义）

### 完整业务能力（16 项）

| 层 | 能力 | 实现 |
|----|------|------|
| 协议层 | HTTP→HTTPS 重定向 | `redirect.rs` — 301 跳转 |
| | TLS 终结 | `main.rs` — 加载证书，H2 |
| | 上游代理 | `gateway.rs` — ProxyHttp 五阶段 |
| 身份层 | OIDC Discovery + JWKS | `jwks.rs` — 定时刷新公钥缓存，ES256 硬锁 |
| | JWT 离线验签 | `verify.rs` — kid→公钥→验签，手动 exp 三态，jti 黑名单 |
| | Token 静默续签 | `refresh.rs` — AT 濒临过期→RT 换新 AT/RT，Redis 30s 去重 |
| | 零信任身份头清洗 | `gateway.rs` — 剥离客户端所有 X-* 伪造头 |
| | 安全头注入 | `gateway.rs` — X-User-Id、Authorization、HMAC 签名 |
| OAuth Client | PKCE 生成 | `oauth.rs` — CSPRNG 32 字节→code_verifier→SHA256→challenge |
| | /authorize 跳转 | `gateway.rs` — 组装 OAuth URL + 4 个临时 Cookie |
| | Callback 拦截+Token 交换 | `gateway.rs` — CSRF state→PKCE→nonce→POST /token→Set-Cookie |
| 基础设施 | 速率限制 | `rate_limiter.rs` — /auth/* 20/min、/token 30/min |
| | 监控指标 | `metrics.rs` — AtomicU64 无锁计数器 |

| ❌ 不做 | 说明 |
|--------|------|
| 权限查询 | 不查 Redis 权限数据 |
| 权限注入 | 不注入 X-User-Permissions |
| 鉴权判断 | 不判断用户是否有某权限 |

### ADR-009 架构决策（已实现，2026-07-23）

- 认证决策收敛为 `AuthDecision` 枚举（Pass / Interrupted / PkceRequired），`request_filter` 中唯一决策点
- `OAuthConfig` 对所有 upstream 强制必填，`client_secret` 必填
- PKCE/认证逻辑由 Gateway 独立完成，不再透传 Portal
- `authenticate::check` 返回 `Result<AuthDecision>`，`match expiry` 替代 `matches!`
- 已删除项：`respond_auth_failure` HTML 透传、`oauth_passthrough_verifier`、`oidc_provider_name`、`Gateway.oidc_provider_name` 字段
- 核心实现文件：`gateway/src/auth/mod.rs`（AuthDecision）、`gateway/src/authenticate.rs`（check）、`gateway/src/config.rs`（OAuthConfig 必填）

---

## 通用概念

| 术语 | 说明 |
|------|------|
| **有界上下文 (BC)** | DDD 术语。当前 5 个 BC：Identity、Authorization、AuthN/OAuth、Audit、Gateway |
| **OBAC** | Organization-Based Access Control。Department 是 Role 的 namespace，数据范围通过角色部门子树推导 |
| **权限码命名空间化** | `code = "{clientId}:{resource}:{action}"`（ADR-008） |
| **JWT 最小化** | AT 仅含 `sub` + `jti` + 标准 claims，鉴权数据在 Redis（ADR-006） |
| **子应用自取鉴权** | Gateway 只注入身份，子应用从 Redis 自取权限并校验（ADR-007） |
| **Server Action** | Next.js 16 `"use server"` 函数，内部页面写操作 |
| **data.ts** | Next.js 16 Cache Component 读模型，`"use cache"` + `cacheLife()` |
| **Domain 层** | 纯 TypeScript，零框架依赖，禁止 `import "next/*"` |
| **DomainError** | 领域错误基类，`mapDomainError()` 统一映射 HTTP |
| **`@auth-sso/contracts`** | 共享包：枚举值、错误码、权限码、OIDC 常量的唯一真相源 |

---

## 废弃/待清理概念

| 概念 | 状态 | 替代方案 |
|------|------|----------|
| ~~JWT 中 `roles[]`/`permissions[]`/`deptIds[]`~~ | 废弃（ADR-006） | Redis `user:{sub}:perms` |
| ~~`refresh_tokens.client_id`~~ | 废弃（ADR-006） | RT 统一用户级 |
| ~~`permissions.resource` / `permissions.action`~~ | 废弃（ADR-008） | code `{clientId}:{resource}:{action}` 自包含 |
| ~~`DATA` 权限类型~~ | 废弃，待清理 | ADR-002：数据范围通过角色-部门绑定 |
| ~~`access_tokens` 表~~ | 预留，不使用 | ADR-004：JWT 无状态 + Redis jti 黑名单 |
| ~~`menus` 表 (v2)~~ | 已合并至 `permissions` | ADR-001：统一权限树 |
| ~~`data_scope_type` (v3.1)~~ | 已移除 | ADR-002：角色-部门绑定 |
| ~~`role_data_scopes` (v3.1)~~ | 已移除 | ADR-002 |
| ~~`role_clients` (v3.1)~~ | 已移除 | 权限 OIDC 准入通过 `permissions.client_id` |

---

## 相关文档

- `docs/adr/ADR-001-unified-permission-tree.md`
- `docs/adr/ADR-002-role-department-binding.md`
- `docs/adr/ADR-003-gateway-as-oauth-client.md`
- `docs/adr/ADR-004-stateless-jwt-redis-blacklist.md`
- `docs/adr/ADR-005-three-layer-security-model.md`
- `docs/adr/ADR-006-jwt-minimization-authz-separation.md`
- `docs/adr/ADR-007-app-self-authorization.md`
- `docs/adr/ADR-008-permission-code-namespace.md`
- `docs/adr/ADR-009-gateway-auth-flow-unification.md`
- `docs/spec/ARCHITECTURE.md`
- `docs/spec/DATABASE.md`
- `docs/spec/RBAC_MODEL_REDESIGN.md`
