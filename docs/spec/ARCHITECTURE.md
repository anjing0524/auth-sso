# 系统架构 -- Auth-SSO

**版本：** v5.0
**状态：** 已发布（Released）
**最后更新：** 2026-06-24

---

## 1. 系统概述

Auth-SSO 是一个基于 Next.js 16 构建的统一身份与访问管理（IAM）平台，采用**无状态 JWT Cookie** 架构，并配备自定义的 Rust 语言 API 网关。该平台由两个主要应用程序和两个共享包组成。

| 组件 | 角色 | 技术栈 |
|---|---|---|
| **Portal**（`apps/portal`） | 企业管理后台、BFF 和 OIDC 提供商——三者合为一体 | Next.js 16 + TypeScript |
| **Gateway**（`apps/gateway`） | 统一 HTTPS 入口、离线 JWT 验证、Cookie 到 Bearer 令牌转换 | Rust + Pingora |
| **`packages/contracts`** | 共享 TypeScript 类型、错误码、权限码、OIDC 常量 | TypeScript |
| **`packages/config`** | 共享环境配置（Zod 模式 + URL 推导）、TypeScript/ESLint 预设 | TypeScript |

Portal **本身就是**身份提供者（Identity Provider）。不存在独立的 IdP 服务。用户认证、令牌签发（ES256 JWT）、OIDC 协议处理、RBAC、组织架构管理和审计日志全部位于同一个 Next.js 应用程序中。Gateway 在下游微服务之前提供一个轻量级、低延迟的认证执行层。

---

## 2. 技术栈

| 类别 | 选型 | 理由 |
|---|---|---|
| **框架** | Next.js 16（App Router、Turbopack） | 全栈 RSC、服务端操作（Server Actions）、路由处理器（Route Handlers） |
| **认证引擎** | 通过 `jose` 库的纯自定义实现 | 完全掌控 OIDC 流程，无框架锁定 |
| **JWT 签名** | ES256（ECDSA P-256），密钥存储在 PostgreSQL `jwks` 表中 | 非对称加密——支持离线验证，无需共享密钥 |
| **API 网关** | Rust + Pingora | 高并发、零成本抽象、离线 JWKS 验证 |
| **数据库** | PostgreSQL 16+ | 认证域与业务域共用 |
| **ORM** | Drizzle ORM | 直接查询模式、类型安全、无仓储层抽象 |
| **缓存 / 黑名单** | Redis（ioredis） | jti 黑名单（紧急吊销）+ 权限上下文缓存（5 分钟 TTL） |
| **样式** | Tailwind CSS 4 + shadcn/ui | 实用优先（Utility-first）、组件库 |
| **包管理器** | pnpm workspaces | 单体仓库（Monorepo）管理、严格的依赖隔离 |

---

## 3. 高层架构

```
浏览器（Browser）
  |
  v
Gateway（Rust/Pingora）
  |-- ES256 离线 JWT 验证（内存级 JWKS 缓存）
  |-- Cookie 提取 + Bearer 头注入
  |-- 路由到 Portal 或下游微服务
  |
  v
Portal（BFF + OIDC 提供商 + 管理后台 UI）
  |-- PostgreSQL 16+（用户、角色、权限、部门、客户端、jwks、refresh_tokens）
  |-- Redis（jti 黑名单、权限缓存）
  |
  v
子应用（OIDC 客户端）
  |-- 通过 Portal 进行 OAuth 2.1 授权码 + PKCE 流程
```

### 3.1 组件职责

| 组件 | 核心职责 | 禁止行为 |
|---|---|---|
| **Portal** | （1）用户凭据验证（bcrypt、数据库存储的密码哈希）。（2）通过数据库存储的密钥对签发 ES256 签名的 JWT。（3）暴露 `/.well-known/jwks` 和 `/api/auth/jwks` 端点。（4）OAuth 2.1 + OIDC 提供商端点（authorize、token、userinfo、introspect、revoke）。（5）将 JWT 写入 HttpOnly Cookie（`portal_jwt_token`、`portal_refresh_token`）。（6）管理用户、部门、角色、权限、OAuth 客户端。（7）基于角色所属部门的 RBAC 数据范围过滤（权限 × 角色部门交集）。（8）用于紧急令牌吊销的 jti 黑名单。（9）审计日志 | 绝不在 Redis 中存储 Portal API 认证的会话状态（无状态 JWT）。绝不向客户端 JavaScript 暴露敏感令牌 |
| **Gateway** | （1）统一 HTTPS 流量入口。（2）提取 `portal_jwt_token` Cookie，通过缓存的 JWKS 验证（ES256、离线）。（3）移除 Cookie，为下游注入 `Authorization: Bearer <JWT>` 头。（4）零信任：100% 离线验证，无需 Redis/DB 的 I/O 操作 | 绝不执行业务层面的权限检查。绝不连接 Redis 或数据库。绝不处理登录/重定向逻辑 |

### 3.2 Portal 内部架构（分层领域驱动设计 DDD）

Portal 遵循四层架构，具有严格的依赖方向：

```
app/（控制层 - Next.js App Router）
  |-- (dashboard)/          管理后台 UI 页面（路由组）
  |     |-- users/          服务端操作（Server Actions）、data.ts（读）、actions.ts（写）
  |     |-- roles/          同上模式
  |     |-- clients/        同上模式
  |     |-- departments/    同上模式
  |     |-- permissions/    同上模式
  |     |-- audit-logs/    同上模式
  |     |-- dashboard/      仪表盘页面
  |-- api/auth/             OIDC 提供商路由处理器（Route Handlers）
  |     |-- oauth2/authorize、token、userinfo、introspect、revoke
  |     |-- login、logout、callback、refresh、jwks
  |-- login/                登录页面
  |-- profile/              用户个人资料页面
  |
  v
domain/（领域层 - 纯 TypeScript，零框架依赖）
  |-- auth/         login.ts、password.ts、oauth-authorize.ts、oauth-code.ts、oauth-client.ts、types.ts
  |-- user/         用户 CRUD 纯函数（userToInsertRow、userToUpdateRow）
  |-- role/         角色 CRUD 纯函数
  |-- permission/   权限 CRUD 纯函数
  |-- department/   部门 CRUD + 循环引用检测
  |-- client/       OAuth 客户端 CRUD 纯函数
  |-- shared/       DomainError、error-mapping、zod-schemas、tree-utils
  |
  v
lib/（无状态工具层 - 可从 domain/ 导入）
  |-- auth/         token.ts（JWT 签名/验证）、verify-jwt.ts、pkce.ts、guard.ts、
  |                 check-permission.ts、data-scope.ts、facade.ts、index.ts
  |-- session/      jwt.ts、cookies.ts（Cookie 读/写）、revoke.ts、index.ts
  |-- permissions.ts     权限上下文查询 + Redis 缓存
  |-- crypto.ts          ID/Secret 生成
  |-- oauth-utils.ts     OAuth 工具辅助函数
  |-- menu-tree.ts       菜单树构建（纯转换）
  |-- audit.ts           审计日志
  |-- type-guards.ts     运行时类型守卫
  |-- env.ts             环境变量访问
  |-- utils.ts           通用工具函数
  |
  v
infrastructure/（有状态适配层 - 可从 lib/ 和 domain/ 导入）
  |-- db/    index.ts     Drizzle ORM + postgres-js（单一连接池）
  |-- redis/ index.ts     ioredis 客户端（jti 黑名单、权限缓存）
  |-- auth/  （空）        预留用于未来基础设施层面的认证适配器
```

**层依赖规则（通过约定执行）：**

| 层 | 允许的依赖 |
|---|---|
| `domain/` | 零外部依赖（不依赖 `next/`、`react`、数据库或 npm 包，除了 `jose` 和 `bcryptjs` 用于纯函数） |
| `lib/` | 可以从 `domain/` 和 `infrastructure/` 导入（用于缓存/数据库访问） |
| `infrastructure/` | 可以从 `lib/` 和 `domain/` 导入 |
| `app/` | 可以从所有层导入 |

**CQRS 模式实践：**

在每个 `app/` 子模块中，关注点被分为三种文件类型：

---

## 4. 管理链路设计

Portal 的管理操作（用户 CRUD、角色分配、权限绑定等）遵循统一的 **Layout 鉴权 → data.ts 读 / actions.ts 写 → Domain 纯函数 → DB 事务** 链路。

### 4.1 读取链路（列表查询）

```
Browser → Gateway（验签 + 注入 X-User-Id 头）
  → proxy.ts（Cookie 存在性检查）
  → app/(dashboard)/xxx/layout.tsx（requirePermission 布局守卫，React.cache 去重）
  → app/(dashboard)/xxx/page.tsx（Server Component）
    → data.ts getXxxs(deptIds, userId, params)
      → 'use cache' + cacheLife + cacheTag
      → buildXxxConditions({ keyword, status, deptIds, userId })
      → getUserRoleDeptIds(userId)
        → string[]：inArray(deptIdCol, deptIds) — 角色部门 + 子树展开
        → 空数组：无角色，返回空数据集
      → db.select().from(schema.xxx).where(conditions).limit().offset()
      → COUNT(*) 分页聚合
    → 返回 { data: [...], pagination: { page, pageSize, total, totalPages } }
```

**关键设计原则：**
- `data.ts` 是每个模块**唯一的数据库读入口**，必须 `import 'server-only'`
- 列表查询使用 `'use cache'` 缓存，详细信息查询（`getXxxById`）不缓存以保证实时性
- `data.ts` 不自行为鉴权检查——鉴权在 Layout 层完成，`userId` 作为参数注入
- 数据范围过滤基于用户角色的所属部门（含子部门）统一计算，**严禁**在各 `data.ts` 中手写 dept_id 判断或遗漏过滤

### 4.2 写入链路（Server Action）

```
Browser → Gateway（验签 + 注入头）
  → proxy.ts
  → 客户端组件调用 Server Action
    → withAuth({ permissions: ['xxx:create'] }, async (ctx, rawInput) => {
        // 1. Zod 校验
        const parsed = XxxInputSchema.safeParse(rawInput)
        if (!parsed.success) return { success: false, error: 'VALIDATION_ERROR' }

        // 2. 数据库事务（读-改-写原子化）
        const result = await db.transaction(async (tx) => {
          // 查重/查存在 → 抛 DomainError
          const existing = await tx.query.xxx.findFirst({ where: ... })
          if (existing) throw new DuplicateEntityError('Xxx', 'field')

          // 调领域纯函数
          const entity = createXxx(parsed.data, generateId)

          // 行转换 + 写入
          await tx.insert(schema.xxx).values(xxxToInsertRow(entity))
          return entity
        })

        // 3. 缓存失效（必须同时调用 revalidatePath + updateTag）
        revalidatePath('/xxx')
        updateTag('xxx-list')

        return { success: true, data: { id: result.id } }
      })
```

**关键设计原则：**
- `withAuth` 统一处理鉴权 + 错误映射，Action 体内**零鉴权样板、零 try/catch**
- 多表/多行写入**必须**使用 `db.transaction()` 包裹
- 每个写操作必须同时调用 `revalidatePath()`（失效 RSC Payload）和 `updateTag()`（即时失效 `'use cache'` 数据缓存）
- 角色变更后需主动刷新受影响用户的权限缓存：`refreshUserPermissionCache(userId)`
- 非关键副作用（JWT 撤销、审计日志）使用 fire-and-forget 模式，不阻塞主流程

### 4.3 API 路由链路（外部集成/Webhook）

```
外部客户端 → Gateway（验签 + Bearer 注入）
  → app/api/xxx/route.ts
    → GET：withPermission({ permissions: ['xxx:list'] }, async (userId) => {
        const result = await getXxxs(userId, params)  // 委托 data.ts
        return NextResponse.json(result)
      })
    → POST/PUT/DELETE：withPermission({ permissions: ['xxx:create'] }, async (userId) => {
        try {
          // Zod 校验 → 事务 → 领域函数 → DB 写入
          return NextResponse.json({ data: result }, { status: 201 })
        } catch (err) {
          const mapped = mapDomainError(err)  // 统一错误映射
          return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status })
        }
      })
```

**关键设计原则：**
- API Route GET **必须**委托给 `data.ts`，**禁止**直接操作数据库
- API Route 写操作使用手动 `try/catch` + `mapDomainError`（因为需要返回 `NextResponse` 而非 `ApiResponse`）
- Controller 选择原则：内部页面操作用 Server Action，外部集成/Webhook/跨域用 REST Route Handler

### 4.4 权限缓存刷新链路

角色权限变更时，需要刷新所有受影响的用户的权限上下文：

```
角色权限变更（角色绑定新权限 / 用户分配新角色 / 角色删除）
  → 事务提交后
  → invalidateRoleBoundUsersCache(roleId)      // 查询所有绑定该角色的用户
  → refreshUsersPermissionCache(userIds)        // 批量刷新 Redis 缓存
  → 用户下次请求时：
    → resolveIdentity() → claims 中携带旧权限（JWT 签发时的快照）
    → 前端静默刷新 Token → Portal 重新签发 JWT（含新权限）
    → 或管理员强制下线用户 → jti 黑名单 → 用户被迫重新登录
```

---

## 5. 认证与单点登录流程

### 5.1 Portal 登录流程（OAuth 2.1 授权码 + PKCE）

```
1. [浏览器]     GET /login
2. [Portal]      渲染登录页面
3. [用户]        提交邮箱 + 密码
4. [Portal]      POST /api/auth/login
                    |- 验证凭据（bcrypt 比对）
                    |- 签发 login_session JWT（ES256、5 分钟 TTL）
                    |- 设置 login_session HttpOnly Cookie
                    |- 重定向到 /api/auth/oauth2/authorize?response_type=code&...
5. [Portal]      GET /api/auth/oauth2/authorize
                    |- 验证 login_session Cookie
                    |- 验证 PKCE code_challenge（S256）
                    |- 签发授权码（不透明、数据库存储、1 分钟 TTL）
                    |- 重定向到 callback，携带 ?code=...
6. [Portal]      GET /api/auth/callback?code=...
                    |- 通过授权码兑换令牌（后端通信，POST 到 /api/auth/oauth2/token）
                    |- 将令牌写入 HttpOnly Cookie：
                       portal_jwt_token    （ES256 JWT、HttpOnly Secure SameSite=Lax、maxAge=1h）
                       portal_refresh_token（不透明、HttpOnly Secure SameSite=Lax、path=/、maxAge=7d）
                    |- 重定向到 /（仪表盘）
```

**架构说明：** Portal 在一个进程中同时充当 BFF 和 OIDC 提供商。登录流程是单应用流程——初始登录后无需跨服务重定向。

### 5.2 单点登录流程

1. 用户访问子应用（已在 Portal 注册的 OIDC 客户端）。
2. 子应用使用适当的 OIDC 参数将用户重定向到 Portal 的 `/api/auth/oauth2/authorize`。
3. 如果用户已有活跃会话，浏览器会自动发送 `portal_jwt_token` Cookie。
4. Portal 验证 JWT。如果有效，跳过登录界面，立即签发授权码。
5. 子应用通过授权码兑换令牌（后端通信）并建立自己的会话。

### 5.3 Gateway 请求流程

1. 浏览器发送携带 `portal_jwt_token` Cookie 的 API 请求。
2. Gateway 从 Cookie 头中提取 JWT。
3. Gateway 使用内存中的 JWKS 缓存验证 JWT 签名（ES256、100% 离线）。
4. 验证成功：移除 Cookie 头，注入 `Authorization: Bearer <JWT>`，转发到下游服务。
5. 验证失败：返回 `401`，附带 `WWW-Authenticate: Bearer` 头。

### 5.4 令牌刷新流程（Gateway 服务端静默续签）

续签在 **Gateway（Rust/Pingora）** 层完成，对 Portal 自身 + 所有第三方子应用的请求统一生效，前端和子应用无需感知、无需任何客户端代码：

**两笔独立 HTTP 请求：**

- **请求 A**（用户原始请求，如 `GET /dashboard`）：浏览器 → Gateway → Portal
- **请求 B**（Gateway 发起的续签，`POST /api/auth/refresh`）：Gateway → Portal（server-to-server）

**上行（浏览器 → Gateway → Portal）：**

1. Gateway `request_filter` 验签 AT → 得到 `claims.exp`。
2. 当 `exp - now < 300s`（`REFRESH_THRESHOLD_SEC`）且 `portal_refresh_token` Cookie 存在时发起请求 B。
3. 请求 B：Gateway 向 `http://{portal.upstream}/api/auth/refresh` 发 POST，携带 `Cookie: portal_refresh_token={rt}`——Portal 内部校验 + 轮换（`rotateRefreshToken`），并**重读最新权限上下文重签 AT**。
4. 续签成功 → 解码新 AT payload（不验签）提取 sub/jti → 更新 ctx 中的 `Authorization` / `X-User-Id` / `X-User-Jti`。
5. `upstream_request_filter` 中：
   - **公开路径**（含 `/api/auth/refresh`）：Cookie 透传，不做修改。
   - **非公开路径**：剥离 `portal_refresh_token` cookie（RT 不暴露给 Portal）；若有新 AT 则替换 `portal_jwt_token`。
6. 进程内 30s 去重（`refreshDedup`），防止过期窗口内并发请求反复轮换 RT（旧 RT 轮换后即被撤销）。

**下行（Portal → Gateway → 浏览器）：**

7. Portal 正常处理请求 A → 响应 HTML/JSON（**不**含 auth cookie）。
8. Gateway `response_filter`：若续签成功 → 向响应追加 `Set-Cookie` 下发新 AT + RT（`Path=/; HttpOnly; SameSite=Lax; Max-Age=3600/604800`）。
9. 浏览器收到响应后更新 Cookie。

**续签失败处理：** 静默继续，旧 AT 仍有效，由下游 `resolveIdentity()` 处理。

> `POST /api/auth/refresh` 端点保留，供浏览器直接调用作为 fallback；其逻辑与 Gateway 续签共用 Portal 的 `rotateRefreshToken`。
>
> 安全性：
> - `portal_refresh_token` 为 HttpOnly + SameSite=Lax，path 放宽至 `/` 以便 Gateway 在全路径读取。
> - Gateway 在转发给 Portal 时**剥离 RT cookie**，RT 只存在于 浏览器 ↔ Gateway 之间，Portal 的非 refresh 端点永远看不到 RT。
> - Gateway → Portal 的续签请求走内网 HTTP（`portal.upstream`），不经公网。

---

## 6. 认证授权全链路

Auth-SSO 的请求处理全链路由 **11 层** 组成，按职责划分为三段：

- **第 1–6 层 · 认证授权段**：从边缘网关到数据行级过滤，构成深度防御（Defense in Depth），是真正的「认证（你是谁）+ 授权（你能做什么、能看哪行）」逻辑。
- **第 7–9 层 · 业务执行段**：读写事务、领域规则校验、统一错误映射。认证授权在第 6 层即已完成，本段不再承担鉴权职责。
- **第 10–11 层 · 横切支撑段**：Cookie/Session 生命周期管理与权限上下文缓存，不在每次鉴权请求的关键路径上。注意：第 11 层权限缓存服务于 **token 签发、第 6 层数据范围过滤、`/api/me/permissions`**，而**非**第 5 层 `checkPermission` 的内部实现——后者纯读 JWT claims，零 DB / 零 Redis；第 10 层仅在登录/登出/刷新时介入。

> 说明：早期的「认证授权八层」说法对应本节的第 1–6 层加部分支撑组件。下文为完整链路。

### 6.1 链路总览

```
客户端浏览器
  │ HTTPS
  ▼
┌─────────────────────────────────────────────────┐
│ 第 1 层：Gateway（Rust/Pingora）                  │
│ · PathMatcher 公开路径白名单检查                   │
│ · Cookie 提取 portal_jwt_token                    │
│ · kid → DecodingKey（内存缓存）                    │
│ · ES256 离线验签（100% 无 I/O）                    │
│ · Redis jti 黑名单检查（可选，Redis 不可用时放行）    │
│ · 注入 X-User-Id、X-User-Jti、Authorization 头    │
│ · 微服务路由（/api/v1/*）：剥离 Cookie + Bearer 注入 │
└──────────────┬──────────────────────────────────┘
               │ X-User-Id、Authorization（Bearer）
               ▼
┌─────────────────────────────────────────────────┐
│ 第 2 层：proxy.ts（Next.js 中间件）               │
│ · 公开路径白名单（/login、/oauth2、/.well-known）   │
│ · 静态资源放行（/_next、/favicon、/images、/fonts） │
│ · Cookie 存在性检查：无 portal_jwt_token → 302     │
│ · ⚠️ 路由守卫，非安全防御层：仅判 Cookie 存在性与    │
│   公开路径，不做 JWT 验签；持有伪造/过期 JWT 的请求  │
│   可穿过本层，密码学保证由第 1、3 层承担              │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 3 层：resolveIdentity() 身份解析               │
│ · 优先：Gateway 信任路径（读 X-User-Id，jwt 只解不验）│
│   ⚠️ 信任前提：Portal 仅接收经 Gateway 转发的流量，  │
│   外部不可直连；否则伪造 X-User-Id 即可冒充任意用户  │
│ · 兜底：verifyAccessToken() 完整验签 + jti 检查     │
│ · React.cache() 同请求去重                         │
│ · 返回 ResolvedIdentity { userId, claims }         │
└──────────────┬──────────────────────────────────┘
               │ userId、claims（roles[]、permissions[]、deptIds[]）
               ▼
┌─────────────────────────────────────────────────┐
│ 第 4 层：鉴权守卫（三种形态）                       │
│ · Server Component：requirePermission()          │
│   → 布局守卫，React.cache 去重，渲染 <Forbidden />  │
│ · Server Action：withAuth()                       │
│   → HOF 包裹，内置 checkPermission + mapDomainError│
│ · API Route：withPermission()                     │
│   → 包装器，返回 NextResponse JSON 格式             │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 5 层：checkPermission() 权限校验               │
│ · Admin 角色（SUPER_ADMIN/ADMIN）直接绕过          │
│ · 权限码匹配：some（默认）/ every（requireAll）      │
│ · 角色码匹配：some / every                          │
│ · 返回 { authorized, userId, claims }              │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 6 层：数据范围过滤（Data Scope）                │
│ · getUserRoleDeptIds(userId) → 部门 ID 列表        │
│   永远返回 string[] → inArray(deptIdCol, deptIds)    │
│   空数组 → 无角色，返回空数据集                       │
│ · 子树展开：ancestors LIKE 物化路径查询               │
│ · 单资源校验：直接 dept_id ∈ deptIds 比对            │
└──────────────┬──────────────────────────────────┘
               │ SQL WHERE 条件已注入
               ▼
┌─────────────────────────────────────────────────┐
│ 第 7 层：data.ts / actions.ts / route.ts        │
│ · 读取：Drizzle 查询链 + 'use cache' 缓存          │
│ · 写入：db.transaction() 事务 + 领域纯函数          │
│ · 缓存失效：revalidatePath + updateTag             │
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
│ 第 9 层：mapDomainError() 统一错误映射             │
│ · EntityNotFoundError → 404                       │
│ · DuplicateEntityError → 409                      │
│ · BusinessRuleViolationError → 422                │
│ · InvalidGrantError → 400                         │
│ · 未知异常 → 500（记录日志）                        │
└──────────────┬──────────────────────────────────┘
               │ HTTP 响应
               ▼
┌─────────────────────────────────────────────────┐
│ 第 10 层：Session 与 Cookie 管理                   │
│ · setJwtCookies：HttpOnly、Secure、SameSite=Lax   │
│ · portal_jwt_token（/ 路径，1h）                   │
│ · portal_refresh_token（/ 路径，7d）     │
│ · 登出/封禁 → jti 黑名单（Redis, TTL=剩余有效期）   │
│ · Redis 不可用时静默降级（不中断服务）               │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│ 第 11 层：权限上下文缓存与刷新                      │
│ · Redis 缓存 Key：portal:user_perms:{userId}      │
│ · TTL 3600s（与 Access Token 对齐）                │
│ · 角色变更 → 主动清除 → 下次请求自动回填             │
│ · 多角色数据范围：取所有角色所属部门（含子部门）的并集    │
└─────────────────────────────────────────────────┘
```

### 6.2 Gateway 验签详细流程

```
extract_token_from_cookie(Cookie header)
  → 零拷贝提取 portal_jwt_token
  → 剥离引号包裹

verify_jwt(token, ctx)
  → decode_header(token) → 获取 kid
  → jwks_cache.get_key(&kid) → 内存 Hash 表查找
  → missing kid → 拒绝
  → Validation::new(Algorithm::ES256)
      · 验证 exp（过期时间）
      · 验证 iss（签发者，与配置比对）
      · 跳过 aud 验证（Portal 自行处理）
      · 动态算法发现：优先使用 OIDC Discovery 返回的算法列表
  → decode::<Claims>(token, &decoding_key, &validation)
  → jti 黑名单检查：Redis EXISTS portal:jti_blocklist:{jti}
      · Redis 不可用 → 容错放行（fail-open）
  → 成功 → 设置 ctx.auth_header、ctx.user_id、ctx.user_jti

handle_auth_failure(session)
  → HTML GET 请求 + 无 RSC 头 → 302 重定向到 /login
  → 其他 → 401 + WWW-Authenticate: Bearer
```

### 6.3 紧急撤销机制（jti 黑名单）

双层 Redis Key 设计：
```
portal:jti_blocklist:{jti} → "1" (TTL = 令牌剩余有效期)
portal:user_jti:{userId}   → Hash {jti: exp, ...} (按用户批量撤销)
```

撤销触发场景：
- 用户登出 → jti + Refresh Token 同时撤销
- 管理员封禁/锁定用户 → `revokeUserAccessByUserId(userId)`
- 密码修改 → 所有活跃 JWT 的 jti 批量写入黑名单
- **权限决策变更** → 强制相关用户重登以获取新 JWT claims（消除 claims 与权限缓存的双源不一致）：
  - 用户角色分配/移除（`/api/users/[id]/roles`）→ 撤销该用户
  - 用户部门变更（`updateUserAction` 中 `deptId` 实际变化）→ 撤销该用户
  - 角色数据范围/状态变更（`updateRoleAction`）→ 批量撤销该角色所有绑定用户（`revokeUsersAccessByUserId`）
  - 角色删除（`deleteRoleAction`）→ 批量撤销绑定用户
  - 仅改名/描述等不影响权限决策的变更不触发撤销，只刷新权限缓存

撤销流程：
```
revokeUserAccessByUserId(userId)
  → Redis HGETALL portal:user_jti:{userId}
  → Pipeline: 每个 jti → SETEX portal:jti_blocklist:{jti} ttl "1"
  → DEL portal:user_jti:{userId}
  → 非阻塞：DELETE FROM access_tokens WHERE userId = userId
```

**关键安全属性：**
- Gateway 和 Portal 双重校验 jti 黑名单，防止单点绕过
- Redis 不可用时全部容错放行（可用性优先）
- TTL 自动过期，防止黑名单无限增长
- 非关键操作（DB 清理）采用 fire-and-forget，不阻塞主流程

### 6.4 三层安全防御总结

| 防御层 | 组件 | 核心职责 | 失败策略 |
|--------|------|---------|---------|
| **边缘层** | Gateway（Rust/Pingora） | JWT 密码学验签 + kid 匹配 + jti 检查 + Cookie 剥离 | 401/302 拒绝 |
| **中间件层** | proxy.ts | Cookie 存在性检查 + 路径白名单（**非密码学验证**，仅快速拦截无 Cookie 请求，安全性不依赖本层） | 302 重定向到登录 |
| **应用层** | resolveIdentity + withAuth/requirePermission | JWT 自验签 + 权限码匹配 + 数据范围过滤 | 401/403 JSON 响应 |

---

## 7. 令牌与密钥管理

### 7.1 JWKS 密钥管理

- **密钥生成**：首次请求时，如果 `jwks` 表中不存在密钥对，则生成 ES256（ECDSA P-256）密钥对。
- **存储**：私钥在 PostgreSQL 中加密存储。公钥以明文 JWK 格式存储。
- **轮换**：如果活跃密钥的使用时间超过 90 天，则生成新的密钥对，并成为主要签名密钥。
- **暴露**：公钥通过 `GET /.well-known/jwks`（OIDC 发现端点）和 `GET /api/auth/jwks`（直接访问）提供服务。
- **Gateway 消费**：Gateway 在启动时获取 JWKS 并缓存在内存中。定期刷新。每次请求零 I/O 操作。

### 7.2 令牌类型

| 令牌 | 签名方式 | 有效期 | 存储位置 | 用途 |
|---|---|---|---|---|
| **登录会话令牌（Login Session Token）** | ES256 JWT | 5 分钟 | `login_session` HttpOnly Cookie | 从登录到授权端点期间携带的临时凭据 |
| **访问令牌（Access Token）** | ES256 JWT | 1 小时 | `portal_jwt_token` HttpOnly Cookie | 认证 + 授权（角色、权限、数据范围） |
| **刷新令牌（Refresh Token）** | 不透明（数据库中 SHA-256 哈希存储） | 7 天 | `portal_refresh_token` HttpOnly Cookie | 静默令牌续期 |

**JWT 载荷**（访问令牌 Access Token）包含：`sub`（用户 ID）、`roles`（角色代码数组）、`permissions`（权限代码数组）、`deptIds`（角色部门 ID 列表，已展开子树，通过 `user → user_roles → roles.dept_id` 获取）、`jti`（唯一标识）、`iat`（签发时间）、`exp`（过期时间）。

### 7.3 紧急吊销（jti 黑名单）

适用于需要立即使令牌失效的场景（账户暂停、强制登出、安全事件）：

1. 将 JWT 的 `jti` 写入 Redis，TTL 设置为令牌的剩余生命周期。
2. 所有 JWT 验证路径在接受令牌前都会查询 Redis 黑名单。
3. `lib/session/revoke.ts` 中的 `revokeUserToken()` 通过从数据库中删除来吊销用户的所有刷新令牌（Refresh Token）。
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
| 回调（Callback） | GET | `/api/auth/callback` | OAuth 授权后回调处理器 |
| 登录（Login） | POST | `/api/auth/login` | 邮箱/密码凭据验证 |
| 登出（Logout） | POST | `/api/auth/logout` | 清除 Cookie + 吊销令牌 |
| 刷新（Refresh） | POST | `/api/auth/refresh` | 令牌刷新（轮换访问令牌 + 刷新令牌对） |

---

## 9. 安全原则

| # | 原则 | 实现方式 |
|---|---|---|
| 1 | **PKCE（S256）** | 所有授权码流程强制使用。`code_challenge_method` 始终为 `S256`。 |
| 2 | **State 与 Nonce** | `state` 防止授权回调上的 CSRF 攻击。`nonce` 防止令牌兑换过程中的重放攻击。 |
| 3 | **Cookie 加固** | 所有认证 Cookie 设置 `HttpOnly`、`Secure`（开发环境下本地降级）、`SameSite=Lax`。 |
| 4 | **令牌隔离** | 不向客户端 JavaScript 暴露任何敏感令牌。访问令牌在服务端进行兑换。 |
| 5 | **后端通信** | 令牌兑换（code 兑换令牌）和令牌刷新均为服务端到服务端通信。授权码通过浏览器传输，但一次性使用且生命周期极短（1 分钟）。 |
| 6 | **零信任网关** | Gateway 和下游微服务通过 JWKS 独立验证 JWT 签名。不进行信任委托。 |
| 7 | **无状态核心** | Portal API 认证为 100% 无状态 JWT。热路径上无需查询 Redis 会话。 |
| 8 | **紧急吊销** | 基于 Redis 的 jti 黑名单，用于安全事件中的即时令牌失效。 |
| 9 | **ES256 非对称签名** | 私钥加密存储在 PostgreSQL 中。公钥通过 JWKS 暴露。服务之间不共享密钥。 |
| 10 | **审计追踪** | 所有认证敏感操作（登录、登出、令牌刷新、权限变更）都记录在 `audit_logs` 表中。 |

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
  |     |-- config/       Zod 环境变量模式、URL 推导、TypeScript/ESLint 配置
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
| `apps/portal/src/lib/auth/guard.ts` | 请求级认证守卫高阶函数（HOC） |
| `apps/portal/src/lib/auth/check-permission.ts` | 权限断言辅助函数 |
| `apps/portal/src/lib/auth/data-scope.ts` | 数据范围过滤（getUserRoleDeptIds — 角色部门 + 子树展开） |
| `apps/portal/src/lib/auth/facade.ts` | 统一认证门面，组合 guard + 权限检查 |
| `apps/portal/src/lib/session/cookies.ts` | Cookie 读/写工具函数 |
| `apps/portal/src/lib/session/jwt.ts` | 会话 JWT 专用辅助函数 |
| `apps/portal/src/lib/session/index.ts` | Session 模块统一导出 |
| `apps/portal/src/lib/session/revoke.ts` | 令牌吊销逻辑 |
| `apps/portal/src/lib/permissions.ts` | 权限上下文查询 + Redis 缓存层 |
| `apps/portal/src/lib/crypto.ts` | ID/Secret 随机生成 |
| `apps/portal/src/infrastructure/db/index.ts` | Drizzle + postgres-js 连接池 |
| `apps/portal/src/infrastructure/redis/index.ts` | ioredis 客户端单例 |
