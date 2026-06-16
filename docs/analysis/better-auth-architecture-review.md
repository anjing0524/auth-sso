# Better Auth 认证架构深度评审

> 日期：2026-06-16 | 评审范围：`apps/portal/src/` 全量认证链路

---

## 一、`authorize/route.ts` 存在意义分析

### 1.1 当前架构

```
                    ┌───────────────────────────────────┐
                    │  GET /api/auth/oauth2/authorize   │
                    │  (自定义 route.ts 拦截)             │
                    │  ├─ Client 状态检查 (ACTIVE/disabled)│
                    │  ├─ 用户 Session 检查               │
                    │  ├─ 用户状态检查 (ACTIVE)            │
                    │  ├─ 角色有效性检查                   │
                    │  ├─ role_clients 访问权限检查        │
                    │  └─ 放行 → Better Auth handler      │
                    └───────────┬───────────────────────┘
                                │
                    ┌───────────▼───────────────────────┐
                    │  Better Auth OAuthProvider 内置     │
                    │  ├─ OAuth 2.1 参数校验 (PKCE等)     │
                    │  ├─ redirect_uri 校验              │
                    │  ├─ 登录页重定向                    │
                    │  ├─ 授权码生成                      │
                    │  └─ Consent 流程                   │
                    └───────────────────────────────────┘
```

### 1.2 Better Auth OAuthProvider 已内置的能力

Better Auth `oauthProvider` 插件在 `/oauth2/authorize` 端点已自动处理：

| 能力 | Better Auth 内置 | 自定义 route |
|------|:---:|:---:|
| `client_id` 必填校验 | ✅ | - |
| PKCE (S256) 校验 | ✅ | - |
| `redirect_uri` 安全校验 | ✅ | - |
| `scope` 解析 | ✅ | - |
| 未登录 → 重定向登录页 | ✅ | - |
| Session 状态管理 | ✅ | ❌ 重复查询 |
| Consent 流程 | ✅ | - |
| 授权码生成与存储 | ✅ | - |
| **Client 启用/停用检查** | ❌ | ✅ |
| **Client `disabled` 标记检查** | ❌ | ✅ |
| **用户 ACTIVE 状态检查** | ❌ | ✅ |
| **角色有效性检查** | ❌ | ✅ |
| **role_clients 访问鉴权** | ❌ | ✅ |
| **管理员绕过** | ❌ | ✅ |
| **中文错误页面** | ❌ | ✅ |

### 1.3 结论：自定义 route 是**必要的，但实现方式可以优化**

自定义 route 添加的 5 项检查是 Better Auth OAuthProvider 插件**原生不支持**的业务逻辑（`role_clients` 是你们的自定义 RBAC 模型）。Better Auth 的 OAuthProvider 没有提供 `onAuthorize` 或 `validateClientAccess` 这类回调钩子。

**但存在两个问题**：

1. **重复查询**：自定义 route 手动查询了 session、user、roles、role_clients，而 Better Auth 内部还会再查一遍（session/clients）。每次 OAuth 授权产生 **6-8 次 DB 查询**。

2. **架构层次不统一**：自定义 route 中有 domain logic（权限判断），但又直接写 Drizzle 查询，没有复用 `oauth-authorize-check.ts` 中的纯函数。

---

## 二、数据库设计评审

### 2.1 整体评价：设计良好，有小问题

**✅ 做得好的：**
- Better Auth 表与业务表清晰分离
- `text` 主键（UUID 友好，不用自增 ID）
- 完整的外键约束 + CASCADE 删除
- 使用 PostgreSQL enum
- 编译期类型守卫（Drizzle ↔ Domain 类型对齐）
- 审计日志（`audit_logs` + `login_logs`）

### 2.2 具体问题

#### 🔴 问题 1：`clients.disabled` 与 `clients.status` 冗余

```sql
-- schema.ts 同时定义了:
status: clientStatusEnum('status').notNull().default('ACTIVE'),  -- 枚举: ACTIVE | DISABLED
disabled: boolean('disabled').default(false),                      -- 布尔标记
```

**风险**：`status = 'ACTIVE'` 但 `disabled = true` 是矛盾状态，自定义 route 同时检查两者，但管理界面可能只更新一个。**这是数据完整性漏洞**。

**建议**：删除 `disabled` 列，统一用 `status` 枚举表达。如果担心破坏性变更，先加数据库约束确保二者一致。

#### 🔴 问题 2：`clients.userId` 缺少外键约束

```sql
-- schema.ts:116
userId: text('user_id'),  -- 无 .references()
-- 但 SQL 迁移文件中也没有对应的 FK
```

`userId` 字段语义不明：
- 如果是 client 的 owner，应该有外键 `→ users.id`
- 如果是创建者，应该叫 `created_by`
- 如果已废弃，应该删除

#### 🟡 问题 3：`menus.status` 类型与迁移不一致

```sql
-- 迁移 SQL (0000): 
"status" text DEFAULT 'ACTIVE' NOT NULL      -- 普通 text

-- schema.ts:301:
status: entityStatusEnum('status').notNull().default('ACTIVE'),  -- enum 类型
```

Drizzle schema 声明了 enum 类型，但实际数据库列是 `text`。Drizzle 不会自动 ALTER TYPE，意味着 enum 校验只在应用层生效，数据库层无约束。

**建议**：创建新迁移将 `menus.status` 改为 `entity_status` 枚举，或移除 schema 中的 enum 声明保持与数据库一致。

#### 🟡 问题 4：`oauthAccessTokens` / `oauthRefreshTokens` 列冗余

```sql
-- oauthAccessTokens:
accessToken: text('access_token'),    -- 无唯一约束
token: text('token').unique(),         -- 有唯一约束

-- oauthRefreshTokens:
refreshToken: text('refresh_token'),  -- 无唯一约束  
token: text('token').unique(),         -- 有唯一约束
```

这是 Better Auth drizzle adapter 的内部约定（`token` 是实际查询键），但两列并存会造成困惑。如果代码只读写 `token`，那么 `accessToken` / `refreshToken` 列永远是 NULL。

**建议**：确认 Better Auth 1.6.17 实际使用的列，如果是迁移遗留物则清理。

#### 🟡 问题 5：`client_type` 枚举定义了但未使用

```sql
-- 迁移中定义了:
CREATE TYPE "public"."client_type" AS ENUM('confidential', 'public');
-- 但 clients 表没有 client_type 列
```

数据库中创建了 `client_type` 枚举类型但 `clients` 表没有引用它。这是未使用的数据库对象。

#### 🟢 问题 6（建议）：`jwks` 表缺少 `kid` 字段

JWKS 标准使用 `kid`（Key ID）来标识和轮换密钥。当前结构只有 `id`（内部主键），缺少标准 `kid`。如果未来需要密钥轮换，这会是阻碍。

### 2.3 RBAC 数据模型评审

```
users ──< user_roles >── roles ──< role_permissions >── permissions
                  │                   │
                  │           role_data_scopes ── departments
                  │
          role_clients ── clients
```

**✅ 设计合理**：
- N:M 关联设计正确
- `role_clients` 解决了"哪些角色可以 SSO 到哪些应用"的业务需求
- `role_data_scopes` 实现了部门级数据隔离
- 超级管理员（`SUPER_ADMIN` / `ADMIN`）通过角色 code 标识，在代码中 bypass

**⚠️ 注意事项**：
- 删除角色时，CASCADE 会清除所有关联，但 `getUserPermissionContext` 缓存可能残留旧数据。目前 `clearUsersPermissionCache` 在角色变更时被调用，但需确保所有角色 CRUD API 都调用了缓存失效。

---

## 三、Better Auth 配置评审

### 3.1 当前配置

```ts
betterAuth({
  basePath: '/api/auth',
  rateLimit: { /* 自定义规则 */ },
  advanced: { useSecureCookies, crossOrigin: true },
  trustedOrigins: getTrustedOrigins(),
  secondaryStorage: redisStorage({ ... }),
  database: drizzleAdapter(db, { provider: 'pg', schema: { ... } }),
  session: { storeSessionInDatabase: true },
  emailAndPassword: { enabled: true, password: { hash, verify } },
  plugins: [bearer(), jwt({...}), oauthProvider({...})],
  user: { modelName: 'users', additionalFields: { publicId: {...} } },
})
```

### 3.2 问题分析

#### 🔴 问题 1：`crossOrigin: true` 全局开启的安全风险

```ts
advanced: {
  crossOrigin: true,  // 全局允许跨域
}
```

Better Auth 的 `crossOrigin` 选项影响 Cookie 的 `SameSite` 属性设置。全局开启意味着所有 Better Auth Cookie（包括 session token）都允许跨站发送。

**风险**：如果 `trustedOrigins` 配置不完整，恶意网站可以发起跨站请求携带认证 Cookie。

**建议**：
- 严格限制 `trustedOrigins` 白名单
- 确认生产环境的 `trustedOrigins` 不包含通配符
- 考虑使用 Better Auth 的 `crossOrigin` per-endpoint 配置（如果 1.6.17 支持）

#### 🟡 问题 2：`rateLimit.customRules` 与 OAuthProvider 内置限流可能冲突

```ts
rateLimit: {
  customRules: {
    '/oauth2/authorize': { window: 60, max: 30 },
    '/oauth2/token': { window: 60, max: 20 },
  },
}
```

而 OAuthProvider 插件内部也内置了 rate limiting：
```ts
oauthProvider({
  rateLimit: {
    token: { window: 60, max: 20 },
    authorize: { window: 60, max: 30 },
  }
})
```

**但是**你的 `oauthProvider({...})` 配置中**没有包含 `rateLimit`**，所以目前不冲突。但将来如果添加 OAuthProvider 级别的 rateLimit，会双重计数。

**建议**：统一在 `auth-instance.ts` 顶层配置 rateLimit，或统一在 `oauthProvider({ rateLimit: {...} })` 中配置，避免混用。

#### 🟡 问题 3：`additionalFields` 声明不完整

```ts
user: {
  additionalFields: {
    publicId: { type: 'string', required: true, unique: true },
  },
}
```

`users` 表有 `username`, `name`, `status`, `deptId`, `mobile`, `avatarUrl` 等更多字段，但 `additionalFields` 只声明了 `publicId`。

**影响**：Better Auth 的 TypeScript 类型推导不会包含未声明的字段，但运行时 Drizzle adapter 会正常读写它们。这导致类型不安全。

**建议**：补充 `additionalFields` 声明，至少包含 `username`, `name`, `status`。`status` 字段特别重要——自定义 route 依赖它来判断用户是否 ACTIVE。

#### 🟢 问题 4（确认）：`secret` 使用环境变量

```ts
secret: process.env.BETTER_AUTH_SECRET,
```

**✅ 正确**。确认生产环境此值已设置且强度足够（≥32 字节随机字符串）。

### 3.3 Session 策略评审

当前使用双 Session 策略：
1. **Better Auth session cookie**（`better-auth.session_token`）——有状态，存储在 DB + Redis
2. **JWT cookie**（`portal_jwt_token`）——无状态，JWKS 验签

```
请求到达 → resolveIdentity()
  ├─ 1. 读取 portal_jwt_token → JWKS 验签 → 成功返回 userId + claims
  └─ 2. 失败 → auth.api.getSession() → 成功返回 userId (claims = null)
```

**✅ 设计合理**：这种双轨制兼容了 Gateway 的无状态 JWT 校验和 Portal 本地的 session 管理。Gateway 只需 JWKS 公钥验签，不需要回调 Portal 查询 session。

**⚠️ 潜在不一致风险**：
- JWT 过期时间 1h，Better Auth session 可能有不同的 TTL
- JWT 黑名单（jti revoke）只影响 JWT 路径，不影响 Better Auth session 路径
- 管理员踢人需要同时清除 JWT + Better Auth session

---

## 四、认证逻辑全链路评审

### 4.1 SSO 登录全流程

```
1. 用户访问 Client App → 重定向到 Portal /api/auth/oauth2/authorize?client_id=X&...
2. 自定义 authorize route 拦截：
   ├─ 检查 client 状态 (ACTIVE + !disabled)
   ├─ 检查用户登录状态 (session)
   ├─ 已登录 → 检查用户状态、角色、role_clients
   └─ 通过 → 放行给 Better Auth handler
3. Better Auth OAuthProvider:
   ├─ 校验 OAuth 参数
   ├─ 未登录 → 重定向到 /login?client_id=X&...
   ├─ 已登录 → consent 检查
   └─ 生成 authorization code → 重定向回 redirect_uri?code=...
4. Client App 后端用 code 换 token (POST /api/auth/oauth2/token)
5. Better Auth 验证 code + PKCE → 签发 access_token + id_token
```

### 4.2 发现的问题

#### 🔴 问题 1：OAuth 登录流程多一次额外跳转

当用户未登录访问 OAuth authorize 时，Better Auth 已经会重定向到 `/login`。但 `login/page.tsx` 在用户登录成功后，**又手动构造 URL 跳转回 `/api/auth/oauth2/authorize`**：

```ts
// login/page.tsx:52-63 - 已登录但有 OAuth 参数的场景
if (session && clientId) {
  const authUrl = new URL('/api/auth/oauth2/authorize', getAppBaseURL());
  // ... 设置参数
  redirect(`${authUrl.pathname}${authUrl.search}`);
}
```

这导致：
1. Better Auth 重定向到 `/login`
2. Login page 检测到已登录 + `clientId` → 又重定向回 `/api/auth/oauth2/authorize`
3. Authorize route 再次检查权限 → 放行给 Better Auth
4. Better Auth 完成授权

**问题在于**：如果 Better Auth OAuthProvider 已经内置了"已登录 → 继续授权"逻辑，那么第 2 步是多余的。但查看你的配置 `loginPage: '/login'`，Better Auth 在登录页返回后依赖客户端重定向回 authorize 端点。这是 Better Auth OAuthProvider 的设计模式，所以这个额外跳转实际上是**Better Auth 的预期行为**，不是 bug。

但这个流程可以优化：如果 `login/page.tsx` 直接调用 Better Auth 的 API 触发授权，而不是让浏览器再做一次重定向。

#### 🟡 问题 2：自定义 route 中硬编码了管理员 code

```ts
// authorize/route.ts:87
const isSuperAdmin = roleDetails.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');
```

而 `oauth-authorize-check.ts` 使用了正确的常量：
```ts
const ADMIN_ROLES = new Set<string>(ADMIN_ROLE_CODES);
```

**应该统一使用 `checkUserClientAccess()` 纯函数**，避免管理员判断逻辑分散在两处。

#### 🟡 问题 3：`client.ts` 在前端暴露了不必要的 `clientSecret`

```ts
// client.ts (浏览器端)
clientSecret: process.env.IDP_CLIENT_SECRET,  // ⚠️ 服务端变量
```

`IDP_CLIENT_SECRET` 没有 `NEXT_PUBLIC_` 前缀，所以浏览器端实际拿不到这个值（始终为 `undefined`）。但这个字段不应该出现在客户端代码中，会造成困惑。

#### 🟡 问题 4：自定义 route 未使用 domain 层纯函数

`authorize/route.ts` 中有完整的权限检查逻辑（87 行），而 `oauth-authorize-check.ts` 已经提取了相同的逻辑为纯函数。route 应该调用 `checkUserClientAccess()` 而不是重复实现。

#### 🟢 问题 5（确认）：双重身份验证机制正确

`verify-jwt.ts` 的 `resolveIdentity()` 先验证 JWT，失败后回退 Better Auth session——这个顺序是正确的。Gateway 注入的 JWT 优先级更高（因为它是经过网关验证的），本地直连场景用 session 兜底。

---

## 五、优化建议（按优先级排序）

### P0 - 立即修复

1. **删除 `clients.disabled` 冗余列**或建立 CHECK 约束确保与 `status` 一致
2. **统一管理员判断逻辑**：route.ts 改用 `checkUserClientAccess()` 或使用 `ADMIN_ROLE_CODES` 常量
3. **授权检查逻辑下沉到纯函数**：`authorize/route.ts` 重构为调用 `checkUserClientAccess()` + DB 查询的薄层

### P1 - 近期优化

4. **补充 `clients.userId` 的外键约束**（或删除该列）
5. **修复 `menus.status` 的类型不一致**（enum vs text）
6. **补充 Better Auth `additionalFields` 声明**
7. **审查 `trustedOrigins` 生产环境配置**
8. **清理 `oauthAccessTokens.accessToken` / `oauthRefreshTokens.refreshToken` 冗余列**

### P2 - 架构改进

9. **考虑用 Better Auth hooks 替代自定义 route**（如果 OAuthProvider 1.6.x 提供了 `before` hook for authorize）
10. **统一 rateLimit 配置位置**（顶层 vs OAuthProvider 插件内）
11. **添加 `jwks.kid` 列**支持未来密钥轮换
12. **减少 OAuth authorize 重复查询**：让自定义 route 把预查询结果通过 context 传递给 Better Auth handler（需要研究可行性）

---

## 六、总结

| 维度 | 评分 | 说明 |
|------|:---:|------|
| 认证流程正确性 | ⭐⭐⭐⭐ | OAuth 2.1 + PKCE 流程完整，认证链路安全 |
| 数据库设计 | ⭐⭐⭐½ | 整体良好，3 个小问题（冗余列、缺失 FK、类型不一致） |
| Better Auth 配置 | ⭐⭐⭐⭐ | 使用合理，crossOrigin 需审查 trustedOrigins |
| RBAC 模型 | ⭐⭐⭐⭐⭐ | 设计完善，role_clients 满足业务需求 |
| 代码架构 | ⭐⭐⭐½ | domain 层已提取但 route 未使用，存在重复逻辑 |
| Session 策略 | ⭐⭐⭐⭐ | 双轨制合理，需注意 JWT 与 session 一致性 |

**核心结论**：自定义 `authorize/route.ts` 是必要的（Better Auth OAuthProvider 不支持你的 RBAC 权限模型），但应重构为调用 domain 纯函数的薄适配层。数据库设计整体合理，有 3 个需要处理的 schema 问题。
