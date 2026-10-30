# Auth-SSO 领域术语表 (Glossary)

> 本文件记录 Auth-SSO 系统的核心领域概念、有界上下文划分及术语定义。
> 最后更新: 2026-10-30（文档审计：审计操作类型按 contracts 实测改为 19 种、Gateway 能力计数按表实测改为 13 项、AT 可选携带 `sid`；对照 `apps/portal/src/db/schema/*.ts` + `apps/portal/drizzle/*.sql` 校正）

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
| `username` | 登录名，全局唯一（大小写敏感，软删除不释放） |
| `email` / `mobile` | 联系方式，条件唯一（`deleted_at IS NULL` 才参与唯一，软删除释放）；**`email` 大小写不敏感**（`ux_users_email_ci` = `lower(email)` 部分唯一索引，ADR-026） |
| `password_hash` | bcrypt 哈希（默认 cost=12，`domain/auth/password.ts` 的 `DEFAULT_PASSWORD_CONFIG`） |
| `password_history` | 密码历史倒序数组（防重用，默认保留最近 5 条，`PASSWORD_HISTORY_MAX`；DB CHECK 兜底上限 10 条） |
| `status` | `ACTIVE` / `DISABLED` / `LOCKED` / `DELETED` |
| `dept_id` | 所属部门（不参与鉴权，创建时必填的归属信息） |
| `deleted_at` | 软删除时间戳（合规保留，不可恢复） |

**邮箱规范化（ADR-026）**：所有用户可写邮箱字段（创建/编辑用户、自助改资料）与登录查询统一走
`EmailSchema`（`domain/shared/zod-schemas.ts` 的 `normalizeEmail` = `trim()` → `toLowerCase()`），
唯一索引 `lower(email)` 是第二道防线。登录日志里的 `username` 记录用户原始输入，不做归一化。

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
- 根部门是**单例**：全局唯一，仅由 seed/迁移在空树引导期建立；运行期不得创建第二个根，也不得把已有部门迁出为根（ADR-002 增补）
- 根部门不可删除（`CANNOT_DELETE_ROOT`）
- 有子部门的不可删除（`DEPARTMENT_HAS_CHILDREN`）
- 有用户的不可删除（`DEPARTMENT_HAS_USERS`）
- 不可移动到自己的子节点（`CANNOT_MOVE_TO_CHILD`）
- `status = DISABLED` 是**生命周期门禁、不追溯**：禁止在该部门下新建子部门/用户/角色、禁止把角色/用户迁入；既有用户的登录、授权、数据范围保持原状（ADR-002 增补 / 决策 D2）

> `ancestors` 语义：**父链、不含自身**；根为 NULL、一级子部门 = 根 ID、二级 = `根/一级`。
> 子树判定必须按 `/` 边界逐段匹配（自身 / 链首直接子 / 链首更深 / 链尾直接子 / 链中），
> 只写 `LIKE 'x/%'` 会漏掉直接子部门（ADR-014 记录的真实缺陷；`lib/authz/data-scope.ts` 为唯一实现）。

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
| `client_secret` | bcrypt 哈希存储（60 字符）；明文只在创建/轮换响应出现一次 |
| `redirect_uris` | 允许的回调地址数组（**精确匹配**，禁止前缀） |
| `scopes` | 授权范围（默认 `openid profile email offline_access`） |
| `access_token_ttl` / `refresh_token_ttl` | **per-client TTL，生效且被服务端钳制**（AT 60s–24h、RT 5min–30d）；缺失/非法回退全局默认 3600 / 604800（ADR-024） |

> **`is_internal` 不是本表的列**：`clients` 表（`apps/portal/src/db/schema/auth.ts`）没有 `is_internal` 字段，schema 与全部迁移均无。**公开客户端不存在**——实现强制 `client_secret`（bcrypt 哈希存储）。

**Portal 自身**：`client_id = "portal"`，是登录链路凭据；管理面对它**只读**（修改/禁用/注销/轮换 Secret 会被 `guardPortalSelfClient` 拒绝）。


### AuthorizationCode（授权码）
OAuth 2.1 authorization_code grant 的一次性授权码。支持 PKCE S256。5min TTL，一次性使用（`used` 标记）。

### RefreshToken（刷新令牌）
绑定发放 client 的授权家族级 refresh_token（RFC 9700 token family；2026-09-28 设计审计恢复 clientId 绑定，撤销不再横扫用户全部会话）。

| 属性 | 说明 |
|------|------|
| `token_hash` | SHA-256 哈希存储（明文不落库） |
| `user_id` | 所属用户 |
| `client_id` | 发放该 RT 的 OAuth Client（Gateway SSO 会话记 `portal`，直连 RP 记各自 client） |
| `scopes` | 授权范围 |
| `revoked` | 非空 = 已撤销（时间戳） |
| `expires_at` | 过期时间 = 签发时刻 + **该 client 的 `refresh_token_ttl`**（钳制到 5min–30d，默认 7 天；ADR-024） |

**Rotation**：刷旧 RT → 撤销旧 RT + 签发新 RT + 新 AT（同一 DB 事务）。
**复用检测**：检测到已撤销 RT 被重复使用 → 级联撤销同授权家族 `(userId, clientId)` 的全部 RT → 拒绝。
**Revocation（撤销原语）**：RT 撤销 SQL 收口于 `lib/auth/token/revocation.ts`（2026-09-30，此前散落 12 处），按领域维度命名：`revokeRefreshTokenById`（轮换/补偿回收）、`revokeRefreshTokenByTokenHash`（登出 / RFC 7009，可选 client 归属限定）、`revokeRefreshTokenFamily`（家族级联，事务内外通用）、`revokeUserRefreshTokens`（强制下线）、`revokeClientRefreshTokens`（管理端，返回真实翻转计数）。禁止在调用方绕行手写 `set({ revoked })` SQL。AT/jti 撤销属 Session 侧（`lib/session/revoke.ts`），双层撤销闭环由编排方（`revokeAllRefreshTokens`、登出）组合。

### JWKS（JSON Web Key Set）
ES256 密钥对存储。

| 字段 | 说明 |
|------|------|
| `kid` | 密钥 ID |
| `public_key` / `private_key` | JWK 格式密钥对 |
| `expires_at` | 过期时间（90 天轮换） |
| `algorithm` | 固定 `ES256` |

### Session（会话）
用户登录态。基于**最小化无状态 JWT**（ADR-006）+ Redis jti 黑名单实现撤销。会话 Cookie（AT/RT）由 **Gateway OAuth 回调统一下发**（ADR-010：Gateway 是唯一 OAuth Client；Portal 侧历史 callback handler 已于 2026-09-30 移除）。

| 概念 | 存储 | 说明 |
|------|------|------|
| Access Token (AT) | Cookie `portal_jwt_token` | ES256 JWT，仅含 `sub` + `jti` + 标准 claims，1h 有效期（per-client 可配置，ADR-024） |
| Refresh Token (RT) | Cookie `portal_refresh_token` | Opaque token，绑定发放 client 的授权家族级，默认 7d 有效期（per-client 可配置，ADR-024） |
| jti 黑名单 | Redis `portal:jti_blocklist:{jti}` | 紧急撤销（按用户 ID 批量撤销时配合 `portal:user_jti:{userId}` Hash） |
| 用户权限上下文 | Redis `portal:user_perms:{userId}` | `{roles[], permissions[], deptIds[]}`，TTL 3600s ±300s；子应用自取鉴权 |

**JWT Claims（最小化后）**：
```typescript
{
  sub: string;        // 用户 ID
  iss: <issuer URL>;  // env PORTAL_ISSUER（缺省 appBaseURL），OIDC Discovery §4.3
  aud: string;        // AT / ID Token = 签发对象 client_id（ADR-013，已实现）；LoginSession = "auth-sso"
  client_id: string;  // AT 显式携带（ADR-013）
  jti: string;
  iat: number;
  exp: number;
  sid?: string;       // LoginSession：绑定校验通过时携带（ADR-023）；AT：refresh 会话 id（个人中心标记当前设备）
}
```

**aud 语义（ADR-013，2026-09-30 定案、已实施）**：OAuth Access Token 的 `aud` = 签发对象 `client_id`，并显式携带 `client_id` claim（`lib/auth/token.ts` 的 `signAccessToken`）；LoginSession 维持体系级 `auth-sso`（`signLoginSession` 用 `PORTAL_AUD`）；ID Token 的 aud = client_id（OIDC Core §2）。契约由 `packages/contracts/src/jwt-contract.test.ts` 钉死。

### ResolvedIdentity（已解析身份）
Portal 的**身份边界**：把「Gateway HMAC 信任路径」与「自验签 JWT Cookie 兜底」两条来源
折叠为同一个值（`resolveIdentity()`，`lib/auth/verify-jwt.ts`）。

| 字段 | 说明 |
|------|------|
| `userId` | 用户内部唯一标识。**唯一**的身份字段 |
| `expiresAt` | Access Token 过期时间（epoch 秒），无法确定时为 `null` |
| `issuedAt` | 签发时间（epoch 秒），无法确定时为 `null` |

**不含 claims**（ADR-016）：曾有一版携带 `claims: PortalJwtClaims`，而 Gateway 信任路径
用空字符串哨兵值 `{ sub:'', iss:'', aud:'', jti:'' }` 伪造它——类型声称非空、实现给出 `''`，
把"字段可能不存在"的负担推给调用方。实测该对象在全部生产代码中只有两个消费者，其中一个
读的 `sub` 恒等于 `userId`，故整体移除。**aud 复核等 claims 用途在 `verify-jwt.ts` 内部完成**，
需新增字段时应扩展显式字段，而不是把整个 claims 对象重新打开。

### PKCE (Proof Key for Code Exchange)
OAuth 2.1 强制安全机制。Gateway 端使用 CSPRNG 生成 32 字节随机数（base64url 后为 43 字符）作 `code_verifier`，SHA-256 计算 `code_challenge`（`apps/gateway/src/oauth.rs` 的 `generate_pkce`）。

---

## Audit & Compliance — 审计与合规

### AuditLog（审计日志）
Append-only 写操作记录，**无 FK 约束**（确保用户/实体删除后日志可读）。

19 种操作类型：`USER_CREATE/UPDATE/DELETE`, `USER_ROLE_ASSIGN`, `ROLE_CREATE/UPDATE/DELETE`, `ROLE_PERMISSION_ASSIGN`, `PERMISSION_CREATE/UPDATE/DELETE`, `DEPARTMENT_CREATE/UPDATE/DELETE`, `CLIENT_CREATE/UPDATE/DELETE`, `CLIENT_SECRET_REGENERATE`, `TOKEN_REVOKE`

### LoginLog（登录日志）
5 种事件：`LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `TOKEN_REFRESH`, `TOKEN_REFRESH_FAILED`。append-only 永久保留（**不分区**）；复合索引 `(user_id, event_type, created_at)` 支撑暴力破解防护的 Redis 故障回退统计（ADR-025）。

### AccessLog（访问日志）
读操作访问记录，按月分区（`PARTITION BY RANGE (created_at)`，主键 `(id, created_at)`），保留 180 天。分区由 `apps/portal/scripts/maintain-access-log-partitions.ts` 预创建/回收（详见 `docs/spec/DATABASE.md` §5.3）。

---

## Gateway (Rust) — 边缘安全（ADR-007/009 职责定义）

### 完整业务能力（13 项）

> 路径均相对 `apps/gateway/src/`。ADR-009 落地后 OAuth 编排从 `gateway.rs` 拆出到 `oauth_flow.rs`（A3-2 / ADR-010 二期），下表按**当前实现**归属。

| 层 | 能力 | 实现 |
|----|------|------|
| 协议层 | HTTP→HTTPS 重定向 | `redirect.rs` — 301 跳转 |
| | TLS 终结 | `main.rs` — 加载证书（`tls.rs` 提供证书存储与握手期热加载），启用 H2 |
| | 上游代理 | `gateway.rs` — ProxyHttp 五阶段（`request_filter` → `upstream_peer` → `upstream_request_filter` → `response_filter` → 连接失败处理） |
| 身份层 | OIDC Discovery + JWKS | `jwks.rs` — 定时刷新公钥缓存，ES256 硬锁 |
| | JWT 离线验签 | `auth/verify.rs` — kid→公钥→验签，手动 exp 三态，jti 黑名单 |
| | Token 静默续签 | `auth/refresh.rs` — AT 濒临过期→RT 换新 AT/RT，Redis 30s 去重 |
| | 零信任身份头清洗 | `gateway.rs` — `strip_identity_headers` 剥离客户端所有 `X-User-*`/`X-Gateway-*`/`Forwarded`/`Proxy-Authorization` 伪造头 |
| | 安全头注入 | `gateway.rs` — `X-User-Id`、`X-User-Jti`、HMAC 签名 |
| OAuth Client | PKCE 生成 | `oauth.rs` — CSPRNG 43 字符 code_verifier→SHA256→challenge |
| | /authorize 跳转 | `oauth.rs` 组装 URL + 4 个临时 Cookie（`pkce_verifier`/`oauth_state`/`oauth_nonce`/`return_to`，300s）与 302，由 `oauth_flow.rs` 的 `oauth_authorize_redirect` 发起 |
| | Callback 拦截+Token 交换 | `oauth_flow.rs` — `intercept` → `check_callback`（CSRF state→PKCE→nonce）→ `TokenExchange::exchange`（POST /token）→ `handle_oauth_callback` Set-Cookie |
| 基础设施 | 速率限制 | `rate_limiter.rs` — 60s 窗口，`/api/auth/oauth2/token` 30 次/min、其余 `/api/auth/*` 20 次/min（`RATE_LIMIT_*` 环境变量覆盖） |
| | 监控指标 | `metrics.rs` — AtomicU64 无锁计数器 + Prometheus 渲染 |

| ❌ 不做 | 说明 |
|--------|------|
| 权限查询 | 不查 Redis 权限数据 |
| 权限注入 | 不注入 X-User-Permissions |
| 鉴权判断 | 不判断用户是否有某权限 |

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
| **范围读口** | `data.ts` 中把数据范围当**必填参数**、经 `scopeFilter` 进入 SQL 的读口（`getUser(id, scope)`）。范围外与不存在**同形**返回 `null`（→ 404），不用状态码区分存在性（ADR-014 第 3 步） |
| **身份读口** | 只按身份读**本人**的读口（`getOwnUser(userId)`；来源是 `resolveIdentity`，不是 URL 参数）。**不受数据范围约束**——操作者的范围来自其**角色**的部门子树，而本人的 `dept_id` 可能落在该子树之外，走范围读口会读不到自己 |
| **收敛动作 (Authorization Effects)** | 权限**决策**变更后对受影响用户的成对动作：**撤销 Access Token**（强制重登）+ **刷新权限上下文缓存**（下次请求即见新权限）。唯一实现 `lib/auth/authorization-effects.ts`，按"是否改变权限决策"分两个具名动词：`revokeAndRefreshAuthorization` / `refreshAuthorizationCache`；顺序固定为**先撤销、后刷新**（安全相关优先，且部分失败下自愈——重登时签发路径会预填充缓存）。受影响用户集有两种**不可合并**的求法：按角色（`userRoles`）与按权限（`userRoles ⋈ rolePermissions`） |
| **`deptIds`（权限上下文缓存）** | Redis `portal:user_perms:{userId}` 中的字段 = 用户所有 ACTIVE 角色的 `roles.dept_id` **原始值列表，未展开子树**（ADR-002 增补 / 决策 D1）。子树展开的唯一实现是 Portal 内 `lib/authz/data-scope.ts` 的 `resolveScope()`（按请求实时）；子应用要按部门做数据范围必须自行展开，不能直接当作"可见部门集合" |
| **登录会话绑定 (sid)** | `login_session` JWT 的 `sid` claim = 本次授权请求的 `session_id`；登录端点仅在浏览器持有该授权请求的一次性 HttpOnly 绑定 Cookie 时写入并回跳；authorize 分支 A 校验 `sid` + 绑定 Cookie 一致才发码（ADR-023） |
| **审计可见范围** | 持 `portal:audit:read` 可见**全量**审计/登录/访问日志（不按部门数据范围过滤）；这是合规只读职能的显式取舍（决策 D3） |
| **机器端点** | `token/introspect/revoke/userinfo/jwks/discovery`。网络位置在 Gateway 入口；Gateway 在 Public 路径保留客户端 `Authorization`、不注入身份头，Portal 自验签（ADR-010 更正段） |

---

## 废弃/待清理概念

| 概念 | 状态 | 替代方案 |
|------|------|----------|
| ~~JWT 中 `roles[]`/`permissions[]`/`deptIds[]`~~ | 废弃（ADR-006） | Redis `portal:user_perms:{userId}` |
| ~~`permissions.resource` / `permissions.action`~~ | 废弃（ADR-008） | code `{clientId}:{resource}:{action}` 自包含 |
| ~~`DATA` 权限类型~~ | 废弃，待清理 | ADR-002：数据范围通过角色-部门绑定 |
| ~~`access_tokens` 表~~ | 已删除（迁移 0001 / ADR-012） | ADR-004：JWT 无状态 + Redis jti 黑名单 |
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
- `docs/adr/ADR-013-per-client-aud-protocol-claims.md`
- `docs/adr/ADR-016-identity-boundary-shape.md`
- `docs/adr/ADR-022-test-authenticity-strategy.md`
- `docs/adr/ADR-023-login-session-binding.md`
- `docs/adr/ADR-024-per-client-token-ttl.md`
- `docs/adr/ADR-025-brute-force-dual-dimension.md`
- `docs/adr/ADR-026-email-normalization.md`
- `docs/spec/ARCHITECTURE.md`
- `docs/spec/DATABASE.md`
