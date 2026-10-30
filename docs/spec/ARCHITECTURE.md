# 系统架构 -- Auth-SSO

**版本：** v5.7
**状态：** 已发布（Released）
**最后更新：** 2026-10-29
**上一版：** v5.6 — 按现有代码校正文档与实现漂移（Redis 用途与 TTL、分层目录、JWT 载荷、端点清单等）
**变更：** v5.7（2026-10-29）— 文档审计轮，按现行代码删除/改写落后章节：§3.2 目录树（`proxy.ts` 在 `src/` 根、`roles/[id]/permissions/`、`audit-logs/[id]/` 与 `app/audit/data.ts`）与 Layout 守卫改述为 `<PermissionGate>`；§5.1 删除「login 写 `oauth_request_binding`」的错误步骤；§6.3 撤销触发场景计数「五类」更正为六条；§7.2 访问令牌载荷补 `sid`；§8 `api/auth/` 入口计数更正；§10 `packages/config` 职责纠正；附录 `lib/authz` 导出清单补 `withGlobalWrite` 与 `operator.ts`。
**历史：** v5.6（2026-10-23）— 按现有代码校正文档与实现漂移：§2 Redis 用途与权限缓存 TTL（3600s ± 300s 抖动，非固定 5 分钟）；§3.2 分层目录与 CQRS 残段重写为真实路径；§4.x 链路对齐 `lib/authz` 门面与 `authorization-effects`；§6 链路的层间顺序与数字；§7 JWT 载荷（aud=client_id 而非 auth-sso）与私钥 AES-256-GCM 加密存储；§8 端点清单（`/api/auth/callback` 无 Portal handler）；§9.1 metrics 独立令牌已落地。全文代码引用统一为「仓库相对路径 + 符号名」，不写行号（行号必漂移）。

---

## 1. 系统概述

Auth-SSO 是一个基于 Next.js 16 构建的统一身份与访问管理（IAM）平台，采用**无状态 JWT Cookie** 架构，并配备自定义的 Rust 语言 API 网关。该平台由两个主要应用程序和两个共享包组成。

| 组件 | 角色 | 技术栈 |
|---|---|---|
| **Portal**（`apps/portal`） | 企业管理后台、BFF 和 OIDC 提供商——三者合为一体 | Next.js 16 + TypeScript |
| **Gateway**（`apps/gateway`） | 统一公网入口、离线 JWT 验证、Cookie 到 Bearer 令牌转换；自托管构建额外承担 Let's Encrypt 内建签发/续期 | Rust + Pingora；`self-managed-tls` 构建额外使用 instant-acme |
| **`packages/contracts`** | 共享 TypeScript 类型、错误码、权限码、OIDC 常量 | TypeScript |
| **`packages/config`** | 共享环境配置（Zod 模式 + URL 推导）；TypeScript/ESLint 预设位于仓库根目录（`tsconfig.base.json` / `eslint.base.mjs`）| TypeScript |

Portal **本身就是**身份提供者（Identity Provider）。不存在独立的 IdP 服务。用户认证、令牌签发（ES256 JWT）、OIDC 协议处理、RBAC、组织架构管理和审计日志全部位于同一个 Next.js 应用程序中。Gateway 在下游微服务之前提供一个轻量级、低延迟的认证执行层。

---

## 2. 技术栈

| 类别 | 选型 | 理由 |
|---|---|---|
| **框架** | Next.js 16（App Router、Turbopack） | 全栈 RSC、服务端操作（Server Actions）、路由处理器（Route Handlers） |
| **认证引擎** | 通过 `jose` 库的纯自定义实现 | 完全掌控 OIDC 流程，无框架锁定 |
| **JWT 签名** | ES256（ECDSA P-256），密钥存储在 PostgreSQL `jwks` 表中 | 非对称加密——支持离线验证，无需共享密钥 |
| **API 网关** | Rust + Pingora | 高并发、零成本抽象、离线 JWKS 验证 |
| **数据库** | PostgreSQL 18+ | 认证域与业务域共用 |
| **ORM** | Drizzle ORM | 直接查询模式、类型安全、无仓储层抽象 |
| **缓存 / 黑名单** | Portal：ioredis（`apps/portal/src/infrastructure/redis/index.ts`，全局单例）；Gateway：bb8 连接池 + redis crate（`apps/gateway/src/redis.rs`） | jti 黑名单（紧急吊销）+ 权限上下文缓存。权限缓存是**旁路缓存**（cache-aside）：key = `portal:user_perms:{userId}`（`REDIS_KEY_PREFIX.USER_PERMS`，见 `packages/contracts/src/oidc.ts` 的 `REDIS_KEY_PREFIX`），TTL = 3600s ± 300s 随机抖动（`apps/portal/src/lib/permissions.ts` 的 `PERM_CACHE_TTL_BASE` / `PERM_CACHE_TTL_JITTER` / `jitteredCacheTtl`），未命中回查 DB 并回填；Gateway **不读**该 key |
| **样式** | Tailwind CSS 4 + shadcn/ui | 实用优先（Utility-first）、组件库 |
| **包管理器** | pnpm workspaces | 单体仓库（Monorepo）管理、严格的依赖隔离 |

---

## 3. 高层架构

```
浏览器（Browser）
  |
  v
Gateway（Rust/Pingora）
  |-- 自托管构建：Rust 内建 ACME HTTP-01 + ARI 自动续期 + TLS 热加载
  |-- 平台 TLS 构建：平台终结公网 TLS，Gateway 仅监听平台注入的 HTTP 端口
  |-- 路径分类（Static / Public / Microservice / Protected）→ 决定验签与 Cookie 处理
  |-- ES256 离线 JWT 验证（ArcSwap JWKS 快照）+ Redis jti 黑名单（fail-close）
  |-- 按分类重写 Cookie + Bearer/X-User-Id/X-User-Jti（+ 可选 HMAC）头注入
  |-- OAuth 2.1 Client：PKCE 生成 + callback 拦截 + 静默续签（30s Redis 去重）
  |-- 自身端点：/healthz、/__gateway/metrics；进程内限流（/api/auth/*）
  |-- 按最长前缀路由到多个上游应用（Portal + 子应用，经 [[upstreams]] 路由表）
  |
  v
Portal（BFF + OIDC 提供商 + 管理后台 UI）
  |-- PostgreSQL 18+（用户、角色、权限、部门、客户端、jwks、refresh_tokens、authorization_codes、审计表）
  |-- Redis（jti 黑名单、user_jti 映射、权限缓存 portal:user_perms:、授权请求暂存、登录失败计数、续签去重）
  |
  v
子应用（OIDC 客户端）
  |-- 通过 Portal 进行 OAuth 2.1 授权码 + PKCE 流程
```

### 3.1 组件职责

| 组件 | 核心职责 | 禁止行为 |
|---|---|---|
| **Portal** | （1）用户凭据验证（bcrypt，成本 12；含未知用户等成本比对以抹平时延枚举，`apps/portal/src/domain/auth/password.ts` 的 `verifyPasswordForUnknownUser`）。（2）通过数据库存储的 ES256 密钥对签发 Login Session / Access Token / ID Token（`apps/portal/src/lib/auth/token.ts` 的 `signLoginSession` / `signAccessToken` / `signIdToken`）。（3）暴露 OIDC Discovery `GET /.well-known/openid-configuration` 与公钥 `GET /api/auth/jwks`（**没有** `/.well-known/jwks` 这个路径）。（4）OAuth 2.1 + OIDC 提供商端点（authorize、token、userinfo、introspect、revoke）。（5）Cookie：写 `login_session`（login）与 `oauth_request_binding`（authorize），并在 refresh/logout 中**轮换或清除** `portal_jwt_token` / `portal_refresh_token`；**首次下发** AT/RT 由 Gateway 在 callback 阶段完成（`apps/portal/src/lib/session/cookies.ts` 仅导出只读函数）。（6）管理用户、部门、角色、权限、OAuth 客户端。（7）基于 ACTIVE 角色 `dept_id`（含子树展开）的 RBAC 数据范围过滤。（8）jti 黑名单与 `refresh_tokens.revoked` 双层吊销。（9）审计日志（`login_logs` / `audit_logs` / `access_logs`） | 绝不在 Redis 中存储 Portal API 认证的会话状态（无状态 JWT）。绝不向客户端 JavaScript 暴露敏感令牌 |
| **Gateway** | （1）作为统一公网流量入口；默认 `self-managed-tls` 构建在 Rust 进程内完成 ACME 账户/order/HTTP-01/CSR/ARI 生命周期，平台 TLS 构建则在编译期排除该能力并只监听平台端口。（2）按路径分类（`PathClass`：Static / Public 白名单 / Microservice `/api/v1/*` / Protected）决定是否验签与 Cookie 处理（`apps/gateway/src/path_matcher.rs` 的 `PathClass` 与 `PathMatcher::classify`）。（3）OAuth 2.1 Client 层：网关级统一凭据 `[gateway.oauth]`（`client_id` / `client_secret`，启动期缺失即拒绝启动，`apps/gateway/src/config.rs` 的 `validate_routing_consistency`）——无 JWT 的 HTML 导航 → 生成 PKCE/state/nonce + 4 个临时 Cookie → 302 `/api/auth/oauth2/authorize`；回调路径由 OIDC Discovery 自定义字段下发（兜底 `/api/auth/callback`），命中即拦截并完成 state/nonce 校验 + code→token 交换 + 会话 Cookie 下发（`apps/gateway/src/oauth_flow.rs` 的 `intercept` 与 `Gateway::handle_oauth_callback`）。（4）对 Protected 路径：从 Cookie 提取 `portal_jwt_token` 离线验签（ES256 + iss + aud=自身 `client_id` + `typ=at+jwt`；`apps/gateway/src/auth/verify.rs` 的 `JwtVerifier::verify`）。（5）**按分类重写上行 Cookie**，而非无条件"移除 Cookie"：Protected 剥离 `portal_refresh_token` 并按需替换 AT；Microservice 移除全部 Cookie；Static/Public 透传（`apps/gateway/src/gateway.rs` 的 `Gateway::rewrite_upstream_cookies`）。（6）验签通过后向下游注入 `Authorization: Bearer <JWT>`、`X-User-Id`、`X-User-Jti`（`apps/gateway/src/gateway.rs` 的 `HEADER_USER_ID` / `HEADER_USER_JTI` 常量与 `upstream_request_filter` 注入）；配置了 `GATEWAY_SHARED_SECRET` 时另附 `X-Gateway-Timestamp` + `X-Gateway-Signature`（HMAC-SHA256，payload `ts:userId:jti`，`upstream_request_filter` 的 HMAC 段）。（7）jti 黑名单检查：验签通过后查询 Redis `portal:jti_blocklist:{jti}`，Redis 不可用或超时即拒绝（fail-close，ADR-011；`apps/gateway/src/redis.rs` 的 `exists`）。（8）按最长前缀将请求路由到多个上游应用（`[[upstreams]]`，`apps/gateway/src/router.rs` 的 `Router::resolve_idx`） | 绝不执行业务层面的权限检查（ADR-006）。绝不连接业务数据库。**不写 Redis 权限缓存**：权限缓存 key `portal:user_perms:*` 只由 Portal 读写。绝不依赖 Certbot、证书 shell 脚本或仓库内开发证书。平台 TLS 构建绝不携带 ACME 客户端模块。 |

### 3.2 Portal 内部架构（分层领域驱动设计 DDD）

Portal 遵循四层架构，具有严格的依赖方向：

```
src/（路径别名 @/ = src/）
├── proxy.ts                   路由守卫（Next.js 16 Proxy）：同源写校验 + Cookie 存在性
├── app/（控制层 - Next.js App Router）
│   ├── (dashboard)/           管理后台（路由组）
│   │     ├── users/           page.tsx + data.ts（读）+ actions.ts（写）+ components/ + [id]/
│   │     ├── roles/           同上 + [id]/permissions/（编辑走 components/ 对话框）
│   │     ├── clients/         同上 + [id]/ + new/
│   │     ├── departments/     同上
│   │     ├── permissions/     同上 + new/ + [id]/edit/
│   │     ├── audit-logs/      page.tsx + [id]/ + components/（读模型是 app/audit/data.ts，无 actions.ts）
│   │     ├── dashboard/       仅 page.tsx + data.ts
│   │     └── profile/         page.tsx + actions.ts + session-actions.ts + sessions.ts（写自己资料）
│   ├── api/auth/              OIDC 提供商 + 会话路由处理器
│   │     ├── oauth2/{authorize,token,userinfo,introspect,revoke}/route.ts
│   │     ├── jwks、login、logout、refresh/route.ts
│   │     └── （无 callback/route.ts —— callback 由 Gateway 拦截，见 §5.1）
│   ├── api/…                  管理面 REST（users、roles、permissions、departments、clients、audit、me、health）
│   ├── .well-known/openid-configuration/route.ts   OIDC Discovery
│   ├── login/                 page.tsx + login-form.tsx
│   └── oauth/error/page.tsx   OAuth 错误页（proxy 白名单放行）
│
├── domain/（领域层 - 纯 TypeScript，零框架依赖）
│   ├── auth/        login.ts、password.ts、password-change.ts、oauth-authorize.ts、oauth-code.ts、
│   │                oauth-client.ts、token-response.ts、types.ts
│   ├── user/        user.ts CRUD 纯函数（userToInsertRow / userToUpdateRow）+ types.ts
│   ├── role/、permission/（含 permission-sync.ts）、department/、client/   各聚合根纯函数 + types.ts
│   └── shared/      errors.ts（DomainError 体系）、error-mapping.ts（mapDomainError）、
│                    zod-schemas.ts、tree-utils.ts、error-fields.ts、time.ts
│
├── lib/（无状态工具层 - 可从 domain/ 与 infrastructure/ 导入）
│   ├── auth/        token.ts（签发/验签/轮换）、token/{signing-keys,revocation}.ts、
│   │                verify-jwt.ts（resolveIdentity）、guard.ts（withAuth / withPermission）、
│   │                check-permission.ts、authorization-effects.ts、brute-force.ts、gateway-hmac.ts、
│   │                client-credentials.ts、oauth-{body,grant,helpers}.ts、navigation-trust.ts、index.ts
│   ├── authz/       数据范围门面（ADR-014）：data-scope.ts（resolveScope / isWithinScope）、
│   │                query.ts（scopeFilter / isScopeDenied）、write.ts（withScopedWrite / withScopedRow / withGlobalWrite）、
│   │                operator.ts（授权决策的授权：loadOperatorAuthorization / assertCanMutateAdminTarget）、index.ts
│   ├── session/     cookies.ts（只读取）、jwt.ts（不验签解码）、revoke.ts（jti 黑名单）、
│   │                auth-request-store.ts（Redis 暂存授权参数）、index.ts
│   ├── permissions.ts     权限上下文查询 + Redis 旁路缓存（getUserPermissionContext 等）
│   ├── cache-invalidation.ts  写后失效唯一真相源（invalidateResource / invalidateResourceFromRoute）
│   ├── audit.ts、crypto.ts、server-error.ts（mapServerError）、db-errors.ts、response.ts、
│   │  oauth-utils.ts、menu-tree.ts、type-guards.ts、env.ts、utils.ts、batch.ts、pagination.ts 等
│   └── account/、role-permission-assignment.ts、user-role-assignment.ts（具名业务操作编排）
│
└── infrastructure/（有状态适配层 - 可从 lib/ 和 domain/ 导入）
    ├── db/index.ts     Drizzle ORM + postgres-js（单一连接池）
    └── redis/index.ts  ioredis 客户端单例
```

**层依赖规则（通过约定执行）：**

| 层 | 允许的依赖 |
|---|---|
| `domain/` | 零外部框架依赖（不依赖 `next/`、`react`、数据库或 Drizzle。可引入 `bcryptjs`、`zod` 等无副作用的 npm 包用于纯函数） |
| `lib/` | 可以从 `domain/` 和 `infrastructure/` 导入（用于缓存/数据库访问） |
| `infrastructure/` | 可以从 `lib/` 和 `domain/` 导入 |
| `app/` | 可以从所有层导入 |

**CQRS 模式实践（读写分离到不同文件，非事件溯源）：**

在每个 `app/(dashboard)/<模块>/` 下，关注点按读/写拆成三种文件：

1. `data.ts` — **读模型唯一入口**：`"use cache"` + `cacheLife()` + `cacheTag()` 包裹的 Drizzle 查询，签名接收 `UserScope`（由 `lib/authz` 的 `resolveScope` 在缓存作用域**外**取得）而非自行鉴权。仅 `users` / `roles` / `clients` / `departments` / `permissions` / `dashboard` 有该文件（证据：`apps/portal/src/app/(dashboard)/users/data.ts` 的 `getUsers`）。
2. `actions.ts` — **写模型**：`'use server'` + `withAuth(...)` 包装，只做 Zod 门禁 → 领域纯函数 → `db.transaction()` → `invalidateResource()`（`lib/cache-invalidation.ts`）。
3. `page.tsx` / `components/` — 只读渲染与交互组件；页面鉴权在 `layout.tsx` 由 `<PermissionGate>` 装载（内部 `requirePermission`，`React.cache` 去重）。

例外：外部集成、跨域与 OIDC 回调写操作放在 `app/api/**/route.ts`，用 `withPermission` 包装，写后失效必须用 `invalidateResourceFromRoute()`。

---

## 4. 管理链路设计

Portal 的管理操作（用户 CRUD、角色分配、权限绑定等）遵循统一的 **Layout 鉴权 → data.ts 读 / actions.ts 写 → Domain 纯函数 → DB 事务** 链路。

### 4.1 读取链路（列表查询）

```
Browser → Gateway（验签 + 注入 X-User-Id / X-User-Jti / Authorization）
  → src/proxy.ts（同源写校验 + portal_jwt_token 存在性；不验签）
  → app/(dashboard)/xxx/layout.tsx
    → <PermissionGate options={ROUTE_ACCESS['/xxx']}>（components/layout/permission-gate.tsx）
      → await connection() + requirePermission(...)（React.cache 去重）→ 失败渲染 <Forbidden />
  → app/(dashboard)/xxx/page.tsx（Server Component）
    → resolveIdentity() → identity.userId
    → resolveScope(db, userId)（lib/authz；必须在 'use cache' 作用域外）→ UserScope
    → data.ts getXxxs(scope, userId, params)
      → 'use cache' + cacheLife + cacheTag
      → isScopeDenied(scope) → 空范围直接返回空数据集
      → buildXxxConditions({ keyword, status, scope, userId })
        → scopeFilter(scope, deptIdCol)：范围内 inArray(...)，范围空恒 FALSE
      → db.select().from(schema.xxx).where(and(...conditions)).limit().offset()
      → COUNT(*) 分页聚合
    → 返回 { data: [...], pagination: { page, pageSize, total, totalPages } }
```

**关键设计原则：**
- `data.ts` 是每个模块**唯一的数据库读入口**，必须 `import 'server-only'`
- 列表查询使用 `'use cache'` 缓存，详细信息查询（`getXxxById`）不缓存以保证实时性
- `data.ts` 不自行为鉴权检查——鉴权在 Layout 层（`PermissionGate` + `ROUTE_ACCESS`）完成，`scope` 与 `userId` 作为参数注入
- 数据范围过滤只经 `lib/authz` 的 `resolveScope` + `scopeFilter` / `isScopeDenied`（空范围恒 `FALSE`，**不会**退化为"不过滤"）；`getUserRoleDeptIds` / `canAccessDept` 已不再是公开 API（`apps/portal/src/lib/authz/index.ts` 的导出清单）

### 4.2 写入链路（Server Action）

```
Browser → Gateway（验签 + 注入头）
  → src/proxy.ts（同源写校验 + Cookie 存在性）
  → 客户端组件调用 Server Action
    → withAuth({ permissions: ['xxx:create'] }, async (ctx, rawInput) => {
        // ctx = { userId }；鉴权失败在 withAuth 内部抛 DomainError 并统一映射
        // 1. Zod 校验
        const parsed = XxxInputSchema.safeParse(rawInput)
        if (!parsed.success) return { success: false, error: 'VALIDATION_ERROR', message }

        // 2. 事务（多表写入 / 需要数据范围守卫时）
        const result = await withScopedWrite(
          { operatorId: ctx.userId, targets: [{ deptId, message: '…' }] },
          async (tx) => {
            // 事务内：查重（唯一性最终由 DB 约束 + mapServerError 兜底 409）
            const existing = await tx.select().from(schema.xxx).where(...).limit(1)
            if (existing.length > 0) throw new DuplicateEntityError('Xxx', 'field')

            const entity = createXxx(parsed.data, generateId)   // 领域纯函数
            await tx.insert(schema.xxx).values(xxxToInsertRow(entity))
            return entity
          },
        )

        // 3. 缓存失效（只经 lib/cache-invalidation.ts；资源表决定路径与标签）
        invalidateResource('xxx')
        return { success: true, data: { id: result.id } }
      })
```

**关键设计原则：**
- `withAuth` 统一处理鉴权 + 错误映射（内部调 `mapServerError`，它是 `mapDomainError` 的服务端超集），Action 体内**零鉴权样板、零 try/catch**
- 多表/多行写入**必须**使用 `db.transaction()` 包裹；涉及数据范围的写路径用 `lib/authz` 的 `withScopedWrite` / `withScopedRow`（快照、断言、写入同一事务，消除 TOCTOU）
- 写后失效**只经** `lib/cache-invalidation.ts`，并按写入位置选入口：Server Action 用 `invalidateResource()`（内部 `updateTag`），Route Handler 用 `invalidateResourceFromRoute()`（内部 `revalidateTag(tag, { expire: 0 })`）。`updateTag` 在 Route Handler 里必抛（Next.js `E872`），而抛出点在事务提交之后 → 「写成功 + 失效未发生 + 5xx」
- **权限决策变更**后的收敛只经 `lib/auth/authorization-effects.ts` 两个具名动词：改变决策（角色/权限/部门归属）→ `revokeAndRefreshAuthorization(userIds)`（先撤销 AT 的 jti，后刷缓存）；不改变决策（改名/描述）→ `refreshAuthorizationCache(userIds)`。单个用户的缓存刷新原语是 `lib/permissions.ts` 的 `refreshUserPermissionCache` / `refreshUsersPermissionCache`
- 非关键副作用（JWT 撤销、审计日志）使用 fire-and-forget 模式，不阻塞主流程

### 4.3 API 路由链路（外部集成/Webhook）

```
外部客户端 → Gateway（Public 路径保留客户端 Authorization；其余分类验签后 Bearer 注入）
  → app/api/xxx/route.ts
    → GET：withPermission({ permissions: ['xxx:list'] }, async (userId) => {
        const scope = await resolveScope(db, userId)     // 门面取范围
        const result = await getXxxs(scope, userId, params)  // 委托 data.ts
        return NextResponse.json(result)
      })
    → POST/PUT/DELETE：withPermission({ permissions: ['xxx:create'] }, async (userId) => {
        // 不写 try/catch：withPermission 已捕获并映射（restError）
        const data = await withScopedWrite({ operatorId: userId, targets }, async (tx) => { … })
        invalidateResourceFromRoute('xxx')              // Route Handler 专用入口
        return restSuccess(data, 201)
      })
```

**关键设计原则：**
- API Route GET **必须**委托给 `data.ts`，**禁止**直接操作数据库
- API Route **不手写 `try/catch`**：`withPermission` 内部统一 `mapServerError` → `restError()`（`apps/portal/src/lib/auth/guard.ts` 的 `withPermission`）
- Controller 选择原则：内部页面操作用 Server Action，外部集成/Webhook/跨域用 REST Route Handler

### 4.4 权限决策变更的收敛链路

角色权限变更时，需要让受影响用户**立即**失去旧凭据并看到新权限：

```
角色/权限/部门归属变更（角色绑定权限、用户分配角色、角色删除、权限更新/删除、用户部门变更）
  → 事务提交后（仅当变更确实影响权限决策）
  → revokeAndRefreshAuthorization(userIds)      // lib/auth/authorization-effects.ts 的 revokeAndRefreshAuthorization
      → revokeUsersAccessByUserId(userIds)       // 先：jti 黑名单（安全相关）
      → refreshUsersPermissionCache(userIds)     // 后：清缓存 → 查 DB → 回填
  → 用户下次请求时：
    → resolveIdentity() 拿到身份；旧 AT 的 jti 已在黑名单 → 验签失败
    → Portal /api/auth/refresh 或 Gateway 静默续签重新签发 AT
    → 或管理员强制下线（/api/users/[id]/force-logout）→ 用户被迫重新登录
```

> Access Token 的 payload **不含** roles/permissions/deptIds（ADR-006 最小化），持权数据只存在于 `portal:user_perms:{userId}` 缓存与 DB。因此"旧 JWT 携带旧权限"不再是风险面——风险面变成"缓存与 DB 不一致"，故上表的动作是**先撤销凭据、后刷新缓存**。

---

## 5. 认证与单点登录流程

### 5.1 Portal 登录流程（OAuth 2.1 授权码 + PKCE）

Portal Admin UI 自身的 OAuth Client 职责由 Gateway（Rust/Pingora）统一承担，与第三方 SSO 应用走完全相同的标准链路。

**阶段一：Gateway 生成 PKCE，触发 OAuth 授权流程**

```
1. [浏览器]     GET /dashboard（受保护页面，无 JWT）
2. [Gateway]    检测 HTML GET + 无 JWT + upstream 配置了 oauth
                  |- 生成 PKCE (code_verifier + code_challenge)
                  |- 生成随机 state（CSRF 防护）、nonce（OIDC 防重放）
                  |- 记录回跳路径 return_to
                  |- Set-Cookie: pkce_verifier + oauth_state + oauth_nonce + return_to
                     (Path=/api/auth/callback, HttpOnly, TTL 5min)
                  |- 302 → /api/auth/oauth2/authorize?client_id=portal&code_challenge=...&state=...&nonce=...
```

**阶段二：AS 引导登录 + 授权码签发（authorize → login → authorize）**

```
3. [Portal]      GET /api/auth/oauth2/authorize（首次授权请求）
                    |- 检测无 login_session / portal_jwt_token
                    |- 将 OAuth 参数暂存 Redis: portal:auth_req:{session_id} (TTL 5min)
                    |- 302 → /login?session_id={sid}（只暴露不透明 session_id）

4. [用户]        在 /login 页面提交邮箱 + 密码

5. [Portal]      POST /api/auth/login → 验证凭据 → 签发 login_session JWT (5min)
                    |- 返回 JSON：绑定成功时 { redirect: "/api/auth/oauth2/authorize?session_id={sid}" }，否则 {}
                       （无 success 字段；失败走 { error, message } + 4xx，见 lib/response.ts 的 restError）
                    |- Set-Cookie: login_session（Path=/api/auth/oauth2/authorize；`sid` claim 仅在
                       绑定校验通过时携带。绑定 Cookie `oauth_request_binding` 不在此写，由 authorize
                       分支 B 更早下发，见 §3.1(5) 与 API §3.3）

6. [浏览器]      JS 导航 → GET /api/auth/oauth2/authorize?session_id={sid}
                    |- 验 login_session（typ=login+jwt、aud=auth-sso）→ sid 与绑定 Cookie 必须匹配
                    |- Redis GETDEL 恢复 OAuth 参数 → 一次性消费
                    |- 签发授权码（绑定 code_challenge，5min TTL，库中只存哈希）
                    |- 302 → redirect_uri?code=...&state=...&iss=...
```

**阶段三：Client 回调换 Token（callback → token，Gateway 边缘拦截）**

```
7. [Gateway]     边缘拦截 GET /api/auth/callback?code=...&state=...
                  （path 取 OIDC Discovery 自定义字段 com_authsso_callback_path，兜底 /api/auth/callback；
                   Portal 侧无该 handler——apps/portal/src/app/api/auth/ 下不存在 callback/route.ts）
                    |- 校验 state Cookie ↔ URL 一致性（fail-close）
                    |- 读取 pkce_verifier Cookie → POST /api/auth/oauth2/token（内网，code_verifier 独立 body 字段）
                    |- 校验 id_token.nonce ↔ Cookie（fail-close 双向闭合，OIDC Core §3.1.2.2）
                    |- 清除 4 个临时 Cookie
                    |- Set-Cookie: portal_jwt_token（Max-Age 3600）+ portal_refresh_token（Max-Age 604800）
                    |- 302 → return_to（经 safe_redirect_path 消毒）|| /
```

**第三方下游应用**（如 ERP）：Gateway 统一生成 PKCE。`[gateway.oauth]` 的 `client_id` / `client_secret` 是**网关级统一凭据**、对所有被代理 upstream 生效（启动期缺失即拒绝启动，`apps/gateway/src/config.rs` 的 `validate_routing_consistency`）；Gateway 在阶段三代为拦截 callback + POST /token + Set-Cookie，下游应用零 OAuth 代码。Portal 自身的会话 Cookie 同样由 Gateway 在阶段三写入（ADR-010：Gateway 是唯一 OAuth Client，Portal 侧历史 callback handler 已于 2026-09-30 移除）。

### 5.2 单点登录流程

1. 用户访问子应用（已在 Portal 注册的 OIDC 客户端）。
2. 子应用使用适当的 OIDC 参数将用户重定向到 Portal 的 `/api/auth/oauth2/authorize`。
3. 如果用户已有活跃会话，浏览器会自动发送 `portal_jwt_token` Cookie（同源）。
4. Portal 按 Cookie 来源分用途验签（login_session → `login+jwt`、AT → `at+jwt`，`aud` 相应区分）；有效则跳过登录界面，立即签发授权码。
5. 子应用通过授权码兑换令牌（后端通信）并建立自己的会话。

### 5.3 Gateway 请求流程

1. 浏览器发送携带 `portal_jwt_token` Cookie 的 API 请求或页面导航请求。
2. Gateway 从 Cookie 头中提取 JWT。
3. Gateway 使用内存中的 JWKS 缓存验证 JWT 签名（ES256、离线、`aud`=自身 client_id、`typ=at+jwt`），随后查询 Redis jti 黑名单（fail-close，见 ADR-011）。
4. 验证成功：按路径分类重写上行 Cookie（Protected 剥离 RT、按需替换 AT），注入 `Authorization: Bearer <JWT>` + `X-User-Id` + `X-User-Jti`，转发到下游服务。
5. 验证失败：
   - **HTML 页面导航**（`GET` + `Accept: text/html` + 无 `RSC` header）→ **Gateway 作为 OAuth Client 生成 PKCE** + Set-Cookie + 302 /authorize。不再透传给 Portal 的 proxy.ts 处理。
   - **API / RSC / POST 请求** → 返回 `401`，附带 `WWW-Authenticate: Bearer` 头。

### 5.4 令牌刷新流程（Gateway 服务端静默续签）

续签在 **Gateway（Rust/Pingora）** 层完成，对 Portal 自身 + 所有第三方子应用的请求统一生效，前端和子应用无需感知、无需任何客户端代码：

**两笔独立 HTTP 请求：**

- **请求 A**（用户原始请求，如 `GET /dashboard`）：浏览器 → Gateway → Portal
- **请求 B**（Gateway 发起的续签，`POST /api/auth/refresh`）：Gateway → Portal（server-to-server）

**上行（浏览器 → Gateway → Portal）：**

1. Gateway `request_filter` 验签 AT → 得到 `claims.exp`。
2. 当 `exp - now < 300s`（`REFRESH_THRESHOLD_SEC`）且 `portal_refresh_token` Cookie 存在时发起请求 B。
3. 请求 B：Gateway 优先向 OIDC Discovery 给出的 `com_authsso_refresh_endpoint`（解析到内网地址）发 POST，失败则回退遍历 OIDC Provider upstream 的 `{scheme}://{upstream}/api/auth/refresh`，携带 `Cookie: portal_refresh_token={rt}` 与 HMAC 签名头（`X-Gateway-Timestamp` + `X-Gateway-Signature`，payload `refresh:{ts}`）——Portal 校验后轮换（`rotateRefreshToken`）、**预填充最新权限上下文**并重签 AT。
4. 续签成功 → 解码新 AT payload（不验签）提取 sub/jti → 更新 ctx 中的 `Authorization` / `X-User-Id` / `X-User-Jti`。
5. `upstream_request_filter` 中：
   - **公开路径 / 静态路径**：Cookie 透传，不做修改。
   - **Protected 路径**：剥离 `portal_refresh_token` cookie；若有新 AT 则替换 `portal_jwt_token`（`apps/gateway/src/gateway.rs` 的 `Gateway::rewrite_upstream_cookies`）。
   - **Microservice 路径**（`/api/v1/*`）：移除全部 Cookie。
6. **跨实例** 30s 去重（Redis `SET NX EX`，key `portal:refresh_dedup:{sub}`），防止过期窗口内并发请求反复轮换 RT（旧 RT 轮换后即被撤销）。

**下行（Portal → Gateway → 浏览器）：**

7. Portal 正常处理请求 A → 响应 HTML/JSON（**不**含 auth cookie——Portal 侧没有下发 AT/RT 的响应路径）。
8. Gateway `response_filter`：若续签成功 → 向响应追加 `Set-Cookie` 下发新 AT + RT（`Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600/604800`）。
9. 浏览器收到响应后更新 Cookie。

**续签失败处理：** 静默继续（AT 仍 NearlyExpired 时），下一次请求重试；AT 已 Expired 且续签失败 → HTML 导航 302 PKCE / 其余请求 401（`apps/gateway/src/authenticate.rs` 模块头的续签行为表）。

> `POST /api/auth/refresh` 端点保留，供浏览器直接调用作为 fallback；其逻辑与 Gateway 续签共用 Portal 的 `rotateRefreshToken`。**Portal 只在验过 Gateway HMAC 签名时**才在 JSON body 回传 token 明文（`body.accessToken` / `body.refreshToken`），浏览器同源脚本只能拿到 `{ expiresIn }` + Set-Cookie。
>
> 安全性：
> - `portal_refresh_token` 为 HttpOnly + SameSite=Lax，path 放宽至 `/` 以便 Gateway 在全路径读取。
> - Gateway 在转发给 Portal 时**剥离 RT cookie**，RT 只存在于 浏览器 ↔ Gateway 之间，Portal 的非 refresh 端点永远看不到 RT。
> - Gateway → Portal 的续签请求走内网（路由表中 `oidc_provider = true` 的 upstream 地址 + `upstream_scheme`），不经公网。

---

## 6. 认证授权全链路

Auth-SSO 的请求处理全链路由 **11 层** 组成，按职责划分为三段：

- **第 1–6 层 · 认证授权段**：从边缘网关到数据行级过滤，构成深度防御（Defense in Depth），是真正的「认证（你是谁）+ 授权（你能做什么、能看哪行）」逻辑。
- **第 7–9 层 · 业务执行段**：读写事务、领域规则校验、统一错误映射。认证授权在第 6 层即已完成，本段不再承担鉴权职责。
- **第 10–11 层 · 横切支撑段**：Cookie/Session 生命周期管理与权限上下文缓存，不在每次鉴权请求的关键路径上。注意：第 11 层权限缓存服务于 **token 签发、第 6 层数据范围过滤、`/api/me/permissions`**，以及第 5 层 `checkPermission` 的数据来源——后者从 Redis 读取权限上下文，Redis 不可用时降级为 DB 查询。第 10 层仅在登录/登出/刷新时介入。

> 说明：早期的「认证授权八层」说法对应本节的第 1–6 层加部分支撑组件。下文为完整链路。
>
> 层编号按**实际执行顺序**排列：`resolveIdentity()`（第 3 层）是守卫（第 4 层）的前置依赖（守卫先要身份才能查权限），而第 4–6 层是 `withAuth` / `withPermission` / `requirePermission` **内部**依次发生的事，不是先后独立的中间件。第 10–11 层是横切支撑：第 10 层在登录/登出/续签时介入，第 11 层为第 5、6 层与 token 签发提供数据。

### 6.1 链路总览

```
客户端浏览器
  │ HTTPS
  ▼
┌─────────────────────────────────────────────────┐
│ 第 1 层：Gateway（Rust/Pingora）                  │
│ · PathMatcher 路径分类（Static/Public/Microservice/Protected）│
│ · Gateway 自身响应：/healthz、/__gateway/metrics   │
│ · Cookie 提取 portal_jwt_token                    │
│ · kid → DecodingKey（ArcSwap 内存快照）            │
│ · ES256 离线验签（密码学部分零 I/O）                │
│ · Redis jti 黑名单检查（fail-close，不可用时拒绝）   │
│ · 注入 X-User-Id、X-User-Jti、Authorization 头    │
│ · （配 GATEWAY_SHARED_SECRET 时）HMAC 签名头       │
│ · 微服务路由（/api/v1/*）：剥离全部 Cookie          │
└──────────────┬──────────────────────────────────┘
               │ X-User-Id、X-User-Jti、Authorization（Bearer）
               ▼
┌─────────────────────────────────────────────────┐
│ 第 2 层：src/proxy.ts（Next.js Proxy）            │
│ · 公开路径白名单（/login、/oauth/error、/.well-known）│
│ · 静态资源放行（/_next、/favicon、/images、/fonts）+ 根 /│
│ · /api/* 整体放行（鉴权由各 route 自行完成）         │
│ · 写请求同源校验（Origin vs 受信来源/X-Forwarded-Host/Host）│
│ · Cookie 存在性检查：无 portal_jwt_token → 302 /login │
│ · PKCE 生成 / OAuth 授权链路已上移到 Gateway 统一完成  │
│ · 不验签（密码学保证由第 1、3 层承担）                │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 3 层：resolveIdentity() 身份解析（L4 的前置依赖） │
│ · 优先：Gateway 信任路径（X-User-Id + HMAC 验签）    │
│   ⚠️ 信任前提：GATEWAY_SHARED_SECRET 已配置且签名有效；│
│   未配置则永不信任该路径，走兜底验签                  │
│ · Gateway 路径下又做 aud=portal 复核（纵深防御）      │
│ · 兜底：verifyAccessToken() 完整验签 + jti 检查      │
│ · React.cache() 同请求去重                          │
│ · 返回 ResolvedIdentity { userId, expiresAt, issuedAt }│
└──────────────┬──────────────────────────────────┘
               │ userId（ADR-006 后无鉴权数据）
               ▼
┌─────────────────────────────────────────────────┐
│ 第 4 层：鉴权守卫（三种形态）                       │
│ · Server Component：requirePermission()          │
│   → PermissionGate（connection + Suspense），渲染 <Forbidden />│
│ · Server Action：withAuth()                       │
│   → HOF，内置 checkPermission + mapServerError     │
│ · API Route：withPermission()                     │
│   → 包装器，返回 NextResponse（restError）          │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 5 层：checkPermission() 权限校验               │
│ · Admin 角色（SUPER_ADMIN/ADMIN）绕过权限码检查     │
│   ⚠️ 角色码检查**不**因管理员而绕过                  │
│ · 权限码匹配：canAny（默认）/ canAll（requireAll）  │
│ · 角色码匹配：some / every                          │
│ · 数据源：getUserPermissionContext（Redis → DB 降级）│
│ · 用户不存在/非 ACTIVE/DB 故障 → 拒绝               │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 6 层：数据范围过滤（Data Scope）                │
│ · resolveScope(executor, userId) → UserScope      │
│   （ACTIVE 角色的 dept_id 经 ancestors 物化路径展开子树）│
│ · 读：scopeFilter → inArray(deptIdCol, deptIds)    │
│   空范围 → 恒 FALSE（绝不退化为"不过滤"）            │
│ · 写：withScopedWrite（targets 非空）/ withScopedRow 在事务内断言  │
│   withGlobalWrite 承载根部门等全局资源写（要求非空范围）            │
│   isWithinScope(scope, targetDeptId)               │
└──────────────┬──────────────────────────────────┘
               │ SQL WHERE 条件已注入
               ▼
┌─────────────────────────────────────────────────┐
│ 第 7 层：data.ts / actions.ts / route.ts        │
│ · 读取：Drizzle 查询链 + 'use cache' 缓存          │
│ · 写入：db.transaction() / withScopedWrite + 领域纯函数│
│ · 缓存失效：lib/cache-invalidation（按写入位置选原语） │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 8 层：Domain 纯函数                             │
│ · 无框架依赖（零 next/react/drizzle 导入）          │
│ · 抛出 DomainError 子类（EntityNotFound 等）        │
│ · 入口校验、状态机、业务规则判定                     │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 9 层：错误映射（唯一出口）                       │
│ · withAuth / withPermission → mapServerError      │
│   （先认 PG 唯一约束 23505 → 409，再走 mapDomainError）│
│ · mapDomainError：状态码随 DomainError 实例走        │
│   EntityNotFoundError → 404、DuplicateEntityError → 409、│
│   BusinessRuleViolationError → 422、ForbiddenError → 403、│
│   UnauthenticatedError → 401、InvalidGrantError → 400、│
│   未知异常 → 500（HTTP 语义；OAuth 端点另经 mapToOAuthError）│
└──────────────┬──────────────────────────────────┘
               │ HTTP 响应
               ▼
┌─────────────────────────────────────────────────┐
│ 第 10 层：Session 与 Cookie 管理                   │
│ · Gateway 下发：Path=/; HttpOnly; SameSite=Lax; Secure│
│ · portal_jwt_token（Max-Age 3600）                 │
│ · portal_refresh_token（Max-Age 604800）           │
│ · Portal 的 login/refresh/logout 分别自写/清除 Cookie│
│   （lib/session/cookies.ts 只读，不提供写入入口）     │
│ · 登出/封禁 → jti 黑名单（Redis, TTL=剩余有效期）    │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 11 层：权限上下文缓存与刷新                      │
│ · Redis Key：portal:user_perms:{userId}           │
│ · TTL：3600s ± 300s 随机抖动；附带 :null（60s）与  │
│   :unavailable（5s）两个防穿透标记                   │
│ · 角色变更 → revokeAndRefreshAuthorization 先撤销   │
│   AT 再刷新缓存（不改变决策时只刷新）                 │
│ · 多角色数据范围：取所有 ACTIVE 角色所属部门（含子树）的并集│
└─────────────────────────────────────────────────┘
```

### 6.2 Gateway 验签详细流程

```
extract_from_header(cookie_header, "portal_jwt_token")
  → Cookie 头先经 collapse_cookie_header 合并（H1/H2）
  → 零拷贝切片，剥离 RFC 6265 双引号

JwtVerifier::verify(token)                     （apps/gateway/src/auth/verify.rs 的 JwtVerifier::verify）
  → decode_header(token) → 取 kid（缺失 → MissingKid）
  → typ 必须存在且等于 "at+jwt"（缺失 → MissingTyp，不符 → InvalidTokenType）
  → jwks_cache.snapshot() + key(&kid)：ArcSwap 快照查表，
      宽限期（JWKS_KEY_GRACE_SECS = 24h）外的条目视为不存在 → UnknownKid
      （UnknownKid 触发一次 30s 单飞节流的按需刷新，本次请求仍拒绝）
  → decode::<Claims>(token, key, &validation)
       · 算法硬锁 ES256（不从 Discovery 动态填充算法列表，防 alg 混淆）
       · iss：取自 OIDC Discovery 的 issuer（env 驱动 URL：PORTAL_ISSUER 优先，
         默认 NEXT_PUBLIC_APP_URL），**不是**固定字符串 "auth-sso"
       · aud：恒校验，预期值 = 网关自身 OAuth client_id（main.rs 注入；
         默认 "portal"，即 Token 的签发对象）
       · exp：jsonwebtoken 内置校验关闭，由网关自行三态判定（Valid /
         NearlyExpired(<300s，含 60s leeway) / Expired）
  → jti 黑名单检查：Redis EXISTS portal:jti_blocklist:{jti}
       · Redis 不可用 / 连接超时 → fail-close 拒绝请求（ADR-011）
  → 成功 → 返回 TokenStatus { token: { user_id, jti }, expiry }

authenticate::check(session, ctx, verifier, refresher, is_html_nav)   （authenticate.rs 的 authenticate::check）
  → Valid：直接 Pass
  → NearlyExpired / Expired：尝试静默续签（缺 RT Cookie 则跳过）
      · 已轮换 → 新 token 必下发（放行或阻断都随响应 Set-Cookie）
      · Expired 且未轮换 / 拿不到可用身份 → 失败决策
  → 返回 AuthDecision 枚举（ADR-009）：
    · Pass → 继续代理请求
    · PkceRequired → Gateway 自动生成 PKCE + 302 /authorize（仅 HTML 页面导航）
    · Interrupted → 已向客户端发送 401 响应（API/RSC 请求）
  → 编译器强制穷尽匹配，新增变体时自动报错
```

### 6.3 紧急撤销机制（jti 黑名单）

双层 Redis Key 设计：
```
portal:jti_blocklist:{jti} → "1" (TTL = 令牌剩余有效期)
portal:user_jti:{userId}   → Hash {jti: exp, ...} (按用户批量撤销)
```

撤销触发场景：
- 用户登出 → jti + Refresh Token 同时撤销
- 管理员封禁/锁定用户 → `revokeUserAccessByUserId(userId)`（`lib/session/revoke.ts` 的 `revokeUserAccessByUserId`）
- 密码修改 → 会话双层终止（RT 撤销 + AT 的 jti 批量写黑名单，见 `lib/account/change-password.ts`）
- **权限决策变更** → 强制相关用户重登，消除凭据与权限缓存的双源不一致：
  - 以下六类**全部经 `lib/auth/authorization-effects.ts` 收敛**，顺序与配对由该 module 固定为「先撤销 AT、后刷新缓存」：
    - 用户角色分配/移除（`/api/users/[id]/roles` POST 与 DELETE，`lib/user-role-assignment.ts` 的 `revokeAndRefreshAuthorization` 调用点）→ 撤销该用户
    - 用户部门变更（`updateUserAction` 中 `deptId` 实际变化，`users/actions.ts` 的 `revokeAndRefreshAuthorization` 调用点）→ 撤销该用户
    - 角色权限绑定变更（`lib/role-permission-assignment.ts`）→ 该角色全部绑定用户
    - 角色数据范围/状态变更（`updateRoleAction`：`hasRolePermissionImpact` 为真时撤销，否则只刷缓存）→ 该角色全部绑定用户
    - 角色删除（`deleteRoleAction`）→ 该角色全部绑定用户
    - 权限更新/删除（`permissions/actions.ts`）→ 该权限经角色关联到的全部用户
  - 仅改名/描述等不影响权限决策的变更 → **只刷缓存**（`refreshAuthorizationCache`），不强制重登

撤销流程：
```
revokeUserAccessByUserId(userId)          （lib/session/revoke.ts 的 revokeUserAccessByUserId）
  → Redis HGETALL portal:user_jti:{userId}
  → Pipeline: 每个 jti → SETEX portal:jti_blocklist:{jti} ttl "1"
  → DEL portal:user_jti:{userId}
  → 返回 { revoked, failed }：Redis 不可用/抛错时 failed=true（永不抛出）
  → 无持久化 AT 行可清理（access_tokens 幽灵表已删除，ADR-012）

revokeAllRefreshTokens(executor, userId)  （lib/auth/token.ts 的 revokeAllRefreshTokens）
  → revokeUserRefreshTokens：DB 更新 refresh_tokens.revoked（失败即抛，fail-close）
  → revokeUserAccessByUserId：JTI 层（尽力而为，成败经返回值上报）
```

**关键安全属性：**
- Gateway 与 Portal 的验签路径都查同一份 jti 黑名单，防止单点绕过
- jti 检查 fail-close（否决性安全数据，ADR-011）；Portal 权限缓存不可用时降级查 DB（缓存性数据，ADR-011）
- TTL 自动过期，防止黑名单无限增长
- 非关键操作（DB 清理）采用 fire-and-forget，不阻塞主流程

### 6.4 三层安全防御总结

| 防御层 | 组件 | 核心职责 | 失败策略 |
|--------|------|---------|---------|
| **边缘层** | Gateway（Rust/Pingora） | JWT 密码学验签 + kid/typ 匹配 + jti 检查 + 按分类重写 Cookie + **PKCE 生成** + OAuth 回调拦截 | 302 /authorize 或 401 |
| **应用层** | resolveIdentity + withAuth / withPermission / requirePermission | JWT 自验签（兜底）+ 权限码匹配 + 数据范围过滤 | 401/403 响应 |
| **路由层** | src/proxy.ts | 同源写校验 + Cookie 存在性检查 + 白名单 + 无 JWT 时 302 /login | 403 / 302 /login |

---

## 7. 令牌与密钥管理

### 7.1 JWKS 密钥管理

- **密钥生成**：首次签发（`getActiveSigningKey()`，含 `/api/auth/jwks` 冷启动兜底）时，若 `jwks` 表中无密钥对则生成 ES256（ECDSA P-256）密钥对；并发请求由进程内锁串行化，避免重复生成（`apps/portal/src/lib/auth/token/signing-keys.ts` 的 `getActiveSigningKey`）。
- **存储**：公钥以明文 JWK JSON 存在 `jwks.public_key`；私钥以 JWK JSON 存 `jwks.private_key`，**配置了 `JWKS_ENCRYPTION_KEY`（64 位 hex = AES-256）时用 AES-256-GCM 加密**（`IV||ciphertext||authTag` base64），未配置则明文存储（`apps/portal/src/lib/crypto.ts` 的 `getEncryptionKey` / `encryptPrivateKey`，调用点在 `signing-keys.ts` 的 `generateAndPersistKeyPair`）。
- **轮换**：密钥有效期 90 天；最新密钥进入续期窗口（到期前 `JWKS_RENEW_AHEAD_SECS` = 24h，`packages/contracts/src/oidc.ts` 的 `JWKS_RENEW_AHEAD_SECS`）时提前生成新密钥对并成为主要签名密钥；JWKS 端点保留过期公钥 `JWKS_PUBLISH_GRACE_SECS` = 2h 保证轮换重叠。
- **暴露**：公钥通过 `GET /.well-known/openid-configuration`（OIDC Discovery 声明 `jwks_uri` = `{baseURL}/api/auth/jwks`）和 `GET /api/auth/jwks`（直接访问）提供服务。
- **Gateway 消费**：Gateway 经 OIDC Discovery 拉取 JWKS 存入 `ArcSwap` 快照，每请求 wait-free 读取、零 I/O；刷新间隔默认 300s（`JWKS_REFRESH_INTERVAL_SECS` 可覆盖，`apps/gateway/src/config.rs` 的 `jwks_refresh_interval_secs`），失败按 30/60/120/300s 渐进退避，`UnknownKid` 可触发 30s 单飞节流的按需刷新；未知 kid 在下次刷新前依旧拒绝。

### 7.2 令牌类型

| 令牌 | 签名方式 | 有效期 | 存储位置 | 用途 |
|---|---|---|---|---|
| **登录会话令牌（Login Session Token）** | ES256 JWT | 5 分钟 | `login_session` HttpOnly Cookie | 从登录到授权端点期间携带的临时凭据（`aud` = 体系级 `auth-sso`，ADR-013/023） |
| **访问令牌（Access Token）** | ES256 JWT | 1 小时（per-client `access_token_ttl`，钳制 60s–24h，ADR-024） | `portal_jwt_token` HttpOnly Cookie | 认证；授权数据在 Redis `portal:user_perms:{userId}`（ADR-006） |
| **刷新令牌（Refresh Token）** | 不透明（数据库中 SHA-256 哈希存储） | 7 天（per-client `refresh_token_ttl`，钳制 5min–30d，ADR-024） | `portal_refresh_token` HttpOnly Cookie | 静默令牌续期 |

**JWT 载荷**（访问令牌 Access Token，ADR-006 最小化后）仅包含身份/协议字段：`sub`（用户 ID）、`client_id`（签发对象，RFC 9068 形态）、`scope`（授予范围，仅当非空时写入）、`sid`（refresh 会话 id，仅在携带时写入；个人中心据此标记"当前设备"，2026-10-26 起）、`iss`（签发者，env 驱动 URL —— `PORTAL_ISSUER` 优先、默认 `NEXT_PUBLIC_APP_URL`，OIDC Discovery §4.3 要求与 discovery URL 同源，见 ADR-012）、`aud`（= 签发对象 client_id，ADR-013，**已实现**：`apps/portal/src/lib/auth/token.ts` 的 `signAccessToken` 中 `.setAudience(clientId)`）、`jti`（唯一标识）、`iat`（签发时间）、`exp`（过期时间）。已删除 `roles`、`permissions`、`deptIds`——鉴权数据全部存于 Redis（`portal:user_perms:{userId}`）。

> 区别两处 `aud`：Access Token 的 `aud` = 签发对象 `client_id`（Portal 自身流程恒为 `"portal"`，Gateway 校验预期值 = 网关自身 client_id）；`"auth-sso"`（`PORTAL_AUD`）只用于 Login Session Token 的 `aud`（`signLoginSession` 中 `.setAudience(PORTAL_AUD)`）——旧文"AT 的 aud 是体系级固定值"已作废。

### 7.3 紧急吊销（jti 黑名单）

适用于需要立即使令牌失效的场景（账户暂停、强制登出、安全事件）：

1. 将 JWT 的 `jti` 写入 Redis，TTL 设置为令牌的剩余生命周期。
2. 所有 JWT 验证路径在接受令牌前都会查询 Redis 黑名单。
3. Refresh Token 的吊销走数据库（`refresh_tokens.revoked` 置时间戳），由 `lib/auth/token/revocation.ts` 的 `revokeUserRefreshTokens` / `revokeAllRefreshTokens` 执行——**不是** `revokeUserToken()`（该函数只把单个 AT 的 jti 写黑名单，`lib/session/revoke.ts` 的 `revokeUserToken`）。
4. 这是对无状态原则的**例外处理**——仅在紧急场景下使用，不会在正常流程中调用。

---

## 8. OIDC 提供商端点

所有端点均为**自定义实现**（不使用第三方 OIDC 库）。以 Next.js 路由处理器（Route Handlers）的形式实现在 `src/app/api/auth/` 中。

| 端点 | 方法 | 路径 | 规范 |
|---|---|---|---|
| 授权（Authorization） | GET | `/api/auth/oauth2/authorize` | OAuth 2.1 授权码 + PKCE 入口 |
| 令牌（Token） | POST | `/api/auth/oauth2/token` | 令牌兑换（code -> access_token + refresh_token） |
| 用户信息（UserInfo） | GET | `/api/auth/oauth2/userinfo` | OIDC UserInfo（OpenID Connect Core 1.0） |
| 内省（Introspection） | POST | `/api/auth/oauth2/introspect` | 令牌内省（RFC 7662） |
| 吊销（Revocation） | POST | `/api/auth/oauth2/revoke` | 令牌吊销（RFC 7009） |
| JWKS | GET | `/api/auth/jwks` | 用于 JWT 验证的公钥集 |
| 回调（Callback） | GET | `/api/auth/callback` | **Gateway 拦截**：该路径由 Gateway 在 `oauth_flow.rs` 的 `intercept` 处理（Discovery `com_authsso_callback_path` 下发），Portal 侧**无 route handler** |
| 登录（Login） | POST | `/api/auth/login` | 邮箱/密码凭据验证 |
| 登出（Logout） | POST | `/api/auth/logout` | 清除 Cookie + 吊销令牌 |
| 刷新（Refresh） | POST | `/api/auth/refresh` | 令牌刷新（轮换访问令牌 + 刷新令牌对）；仅对验过 Gateway HMAC 的调用在 JSON body 回传 token |
| Discovery | GET | `/.well-known/openid-configuration` | OIDC Discovery（issuer / jwks_uri / 各端点 + 自定义扩展字段） |

> **Route Handler 目录即清单**：`apps/portal/src/app/api/auth/` 下只有 `jwks/`、`login/`、`logout/`、`oauth2/{authorize,token,userinfo,introspect,revoke}/`、`refresh/` 五个目录入口，**不存在** `callback/route.ts`。该表因此不维护"是否已实现"的人工状态（那会过期），而以文件系统为准。

---

## 9. 安全原则

| # | 原则 | 实现方式 |
|---|---|---|
| 1 | **PKCE（S256）** | 所有授权码流程强制使用。`code_challenge_method` 始终为 `S256`。 |
| 2 | **State 与 Nonce** | `state` 防止授权回调上的 CSRF 攻击。`nonce` 防止令牌兑换过程中的重放攻击。 |
| 3 | **Cookie 加固** | 所有认证 Cookie 设置 `HttpOnly`、`Secure`（开发环境下本地降级）、`SameSite=Lax`。 |
| 4 | **令牌隔离** | 不向客户端 JavaScript 暴露任何敏感令牌。访问令牌在服务端进行兑换。 |
| 5 | **后端通信** | 令牌兑换（code 兑换令牌）和令牌刷新均为服务端到服务端通信。授权码通过浏览器传输，但一次性使用且生命周期较短（5 分钟）。 |
| 6 | **零信任网关** | Gateway 和下游微服务通过 JWKS 独立验证 JWT 签名。不进行信任委托。 |
| 7 | **无状态核心** | Portal API 认证为 100% 无状态 JWT。热路径上无需查询 Redis 会话。 |
| 8 | **紧急吊销** | 基于 Redis 的 jti 黑名单，用于安全事件中的即时令牌失效。 |
| 9 | **ES256 非对称签名** | 私钥以 JWK 格式存储在 PostgreSQL 中（安全依赖 DB 访问控制）。公钥通过 JWKS 暴露。服务之间不共享密钥。 |
| 10 | **审计追踪** | 认证敏感操作按类型落到三张表：登录/登出/令牌刷新 → `login_logs`；操作审计（权限变更等，经 `withAuth` / `withPermission` 的 `audit` 选项）→ `audit_logs`；数据读取 → `access_logs`（`apps/portal/src/db/schema/logs.ts`） |
| 11 | **可信传输证书** | 自托管部署由 Gateway `self-managed-tls` 构建通过 Rust 内建 ACME 自动签发和续期；平台部署由平台终结公网 TLS，Gateway 使用 `--no-default-features` 构建并在编译期排除 ACME。两种模式互斥且配置不匹配时拒绝启动。 |

### 9.1 入口健壮性与残余风险（2026-10-23 审计批次补充）

| 项 | 现状 | 残余风险/处置 |
|---|---|---|
| 机器端点经 Gateway | Public 路径（`/api/auth/*`、`/.well-known/*`）保留客户端 `Authorization`；Protected/Microservice 仍剥离后按验签注入（ADR-010 更正） | 无：Portal 对 Bearer 自验签 + jti 黑名单 fail-close |
| 路径规范化 | 入口对 dot-segment（`.`/`..`、`%2e` 变体、编码分隔符）**直接 400**（选择"拒绝"而非 `remove_dot_segments`，避免两个规范化解释面） | 无已知绕过；双重编码不可利用 |
| Host 头 | HTTP/1.1 **缺失 Host → 400**；HTTP/1.0 保持兼容（RFC 7230） | **接受残余**：`Host: evil.com` 可影响 absolute Location/redirect_uri（浏览器不可伪造 Host，absolute-form 已 400；非浏览器客户端除外）。不引入 Host 白名单配置——部署层反代负责（决策 D5） |
| 响应安全头 | Gateway 自产响应（healthz/metrics/400/401/302/429）与代理响应（上游未设置时）注入 `Strict-Transport-Security: max-age=31536000` | 未加 `includeSubDomains`/`preload`（避免共享父域误扩散与不可逆） |
| 头清洗 | 保留白名单仅 `X-Forwarded-For/Host/Proto`、`X-Request-Id`、`X-Correlation-Id`、`X-Real-IP`；再纳入 `Forwarded`/`Proxy-Authorization` 的剥离 | `X-Forwarded-Prefix/Port/Server` 仍放行（当前无消费方），精确枚举收窄为 P3 后续 |
| 请求 framing | `CL`+`TE` 并存等歧义未在边缘拒绝，透传上游由 Next 返回错误 | 未复现走私（单响应/重复 CL 400/absolute-form 400）；P3 待排期 |
| metrics 鉴权 | 独立 `GATEWAY_METRICS_TOKEN` 优先、未配置时回退 `GATEWAY_SHARED_SECRET`（`apps/gateway/src/gateway.rs` 的 `metrics_secret` 与 `request_filter` 的 metrics 分支）；比较走**定长 SHA-256 摘要 + 逐字节 XOR 累积**的常量时间实现（`apps/gateway/src/http.rs` 的 `constant_time_eq`） | 抓取器凭证已可与 HMAC 密钥分离；未配置独立 token 时仍共享密钥属部署选择 |
| 观测性 | Gateway 对未信任客户端的 TLS 握手失败按 ERROR 记录（测试环境噪声约 121 条/50min） | 归因已修正（非健康检查造成）；降噪为 P3 |


---

## 10. 包依赖关系

```
auth-sso/
  |-- apps/
  |     |-- portal/       Next.js 16 应用（依赖 contracts、config）
  |     |-- gateway/      Rust/Pingora 二进制程序（从 Portal 端点读取 JWKS）
  |
  |-- packages/
  |     |-- contracts/    共享类型、错误码、权限码、OIDC 常量
  |     |-- config/       Zod 环境变量模式、URL 推导（TypeScript/ESLint 预设在仓库根：`tsconfig.base.json` / `eslint.base.mjs`）
  |
  |-- scripts/            工具脚本（种子数据、维护）
  |-- tests/              E2E（Playwright）、集成测试、可追溯性
```

- `packages/contracts` 是所有权限码、错误码枚举和 OIDC 常量值的唯一真实来源。它**零运行时依赖**。
- `packages/config` 通过 Zod 从 `process.env` 推导并导出一个经过验证的环境配置对象。它不依赖 Portal 内部实现。
- Portal 依赖这两个包。Gateway 是独立应用（Rust），在启动时读取 Portal 的 JWKS 端点。

---

## 附录：关键文件映射

| 路径 | 用途 |
|---|---|
| `apps/portal/src/domain/auth/login.ts` | 登录凭据验证（纯函数） |
| `apps/portal/src/domain/auth/oauth-authorize.ts` | OAuth 授权端点纯函数（authorize 请求校验、PKCE 验证、授权码签发） |
| `apps/portal/src/domain/auth/oauth-code.ts` | 授权码生命周期管理（创建、消费、过期清理） |
| `apps/portal/src/domain/auth/oauth-client.ts` | OAuth Client 领域纯函数（客户端校验、Secret 管理） |
| `apps/portal/src/lib/auth/token.ts` | JWT 签名与验证（jose + JWKS） |
| `apps/portal/src/lib/auth/verify-jwt.ts` | JWT 载荷解码与验证 |
| `apps/portal/src/lib/auth/guard.ts` | 请求级认证守卫高阶函数（withAuth / withPermission） |
| `apps/portal/src/lib/auth/check-permission.ts` | 权限校验核心（Redis → DB 级联查询） |
| `apps/portal/src/lib/authz/index.ts` | 数据范围授权**唯一门面**（ADR-014）：导出 `resolveScope` / `withScopedWrite` / `withScopedRow` / `withGlobalWrite` / `scopeFilter` / `isScopeDenied` / `isWithinScope` / `assertWithinScope`，以及 operator 助手（`loadOperatorAuthorization` / `targetHasAdminRole` / `assertCanMutateAdminTarget`，ADR-029）；不导出 `getUserRoleDeptIds` / `canAccessDept` |
| `apps/portal/src/lib/authz/data-scope.ts` | 范围快照与纯判定（`resolveScope` + `ancestors` 物化路径子树展开、`isWithinScope`） |
| `apps/portal/src/lib/authz/query.ts` / `write.ts` | 读路径条件构造（空范围恒 `FALSE`）/ 写路径事务内快照 + 断言 |
| `apps/portal/src/lib/authz/operator.ts` | 「授权决策的授权」：事务内操作者授权快照与高权目标保护（`loadOperatorAuthorization` / `assertCanMutateAdminTarget`） |
| `apps/portal/src/lib/auth/authorization-effects.ts` | 权限决策变更收敛：`revokeAndRefreshAuthorization`（先撤销后刷新）/ `refreshAuthorizationCache` |
| `apps/portal/src/lib/auth/index.ts` | 鉴权公开入口（直接导出子模块） |
| `apps/portal/src/lib/session/cookies.ts` | Cookie **只读**工具（`getJwtFromCookie` / `getRefreshTokenFromCookie`；写入分散在 login/refresh/logout handler） |
| `apps/portal/src/lib/cache-invalidation.ts` | 写后缓存失效唯一真相源（`invalidateResource` / `invalidateResourceFromRoute`） |
| `apps/portal/src/lib/session/revoke.ts` | jti 黑名单吊销与撤销 |
| `apps/portal/src/lib/session/auth-request-store.ts` | OAuth 授权参数暂存（Redis portal:auth_req:） |
| `apps/portal/src/lib/permissions.ts` | 权限上下文查询 + Redis 缓存层 |
| `apps/portal/src/lib/crypto.ts` | ID/Secret 随机生成；JWKS 私钥 AES-256-GCM 加解密（`encryptPrivateKey` / `decryptPrivateKey`） |
| `apps/portal/src/infrastructure/db/index.ts` | Drizzle + postgres-js 连接池 |
| `apps/portal/src/infrastructure/redis/index.ts` | ioredis 客户端单例 |
| `apps/gateway/src/tls.rs` | TLS 证书完整性校验、内存快照和握手期热加载 |
| `apps/gateway/src/redirect.rs` | HTTP-01 challenge 直出与其余 HTTP 请求强制跳转 |
| `apps/gateway/src/acme.rs` | Rust 内建 ACME 账户、HTTP-01、ARI、签发续期与原子状态持久化 |
| `apps/gateway/Cargo.toml` | `self-managed-tls` 默认 Feature 与平台 TLS 编译边界 |
