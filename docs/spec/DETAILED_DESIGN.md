# 详细设计 (Detailed Design) - Auth-SSO

**版本**: v1.0 · **状态**: 正式发布 · **最后更新**: 2026-06-24
**依赖**: [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md)

---

## 目录

1. [认证流程详细设计](#1-认证流程详细设计)
   - [Portal 登录流程](#11-portal-登录流程完整时序)
   - [SSO 单点登录流程](#12-sso-单点登录流程)
   - [Token 刷新流程](#13-token-刷新流程)
   - [登出流程](#14-登出流程)
2. [鉴权体系详细设计](#2-鉴权体系详细设计)
   - [三层鉴权架构](#21-三层鉴权架构)
   - [resovleIdentity 身份解析](#22-resolveidentity-身份解析)
   - [requirePermission 布局守卫](#23-requirepermission-布局守卫)
   - [withAuth Server Action 守卫](#24-withauth-server-action-守卫)
   - [withPermission API Route 守卫](#25-withpermission-api-route-守卫)
   - [权限检查逻辑](#26-权限检查逻辑)
3. [数据范围过滤详细设计](#3-数据范围过滤详细设计)
   - [数据范围模型](#31-数据范围模型)
   - [getUserRoleDeptIds 函数](#32-getuserroledeptids-函数)
   - [使用模式](#33-使用模式)
   - [子树展开实现](#34-子树展开实现)
4. [缓存策略详细设计](#4-缓存策略详细设计)
   - [Next.js 16 缓存组件](#41-nextjs-16-缓存组件)
   - [权限上下文缓存](#42-权限上下文缓存)
   - [jti 黑名单缓存](#43-jti-黑名单缓存)
   - [JWKS 公钥缓存](#44-jwks-公钥缓存)
5. [错误处理详细设计](#5-错误处理详细设计)
   - [DomainError 类型体系](#51-domainerror-类型体系)
   - [mapDomainError 映射表](#52-mapdomainerror-映射表)
   - [统一错误响应格式](#53-统一错误响应格式)
6. [Gateway 详细设计](#6-gateway-详细设计)
   - [请求处理流水线](#61-请求处理流水线)
   - [JWT 验证流程](#62-jwt-验证流程)
   - [JWKS 缓存与刷新](#63-jwks-缓存与刷新)
   - [路径白名单](#64-路径白名单)
7. [安全设计要点](#7-安全设计要点)
   - [三层防御架构](#71-三层防御架构)
   - [密钥管理](#72-密钥管理)
   - [Token 安全](#73-token-安全)
   - [Cookie 安全](#74-cookie-安全)
8. [密钥与 Token 管理](#8-密钥与-token-管理)
   - [JWKS 密钥生命周期](#81-jwks-密钥生命周期)
   - [Token 类型](#82-token-类型)
   - [紧急撤销机制](#83-紧急撤销机制)
9. [OIDC Provider 端点](#9-oidc-provider-端点)
10. [附录](#10-附录)
    - [附录 A: 关键函数签名参考](#附录-a-关键函数签名参考)
    - [附录 B: 环境变量参考](#附录-b-环境变量参考)

---

## 1. 认证流程详细设计

### 1.1 Portal 登录流程（完整时序）

Portal 自身作为 OAuth 2.1 Client，PKCE 在 proxy.ts（Next.js Proxy 层）生成，浏览器 JavaScript 零接触敏感凭证。

```
┌─────────┐          ┌─────────┐          ┌──────────────┐
│ Browser │          │ Portal  │          │ PostgreSQL   │
│         │          │ (Next)  │          │  + Redis     │
└────┬────┘          └────┬────┘          └──────┬───────┘
     │                    │                      │
     │  1. GET /dashboard │                      │
     ├───────────────────►│                      │
     │                    │                      │
     │  2. proxy.ts: 无 portal_jwt_token Cookie  │
     │     生成 PKCE(code_verifier/challenge)    │
     │     生成 state(随机, CSRF) + nonce(重放)   │
     │     return_to = 原始路径                    │
     │     种 4 个 HttpOnly Cookie:              │
     │     pkce_verifier + oauth_state           │
     │     + oauth_nonce + return_to             │
     │     (Path=/api/auth/callback, TTL 5min)   │
     │     302 → /authorize?client_id=portal     │
     │     &code_challenge=xxx&state=xxx&nonce=xxx│
     ├───────────────────►│                      │
     │                    │  3. authorize 端点:   │
     │                    │  无 login_session /   │
     │                    │  portal_jwt_token     │
     │                    │  → 暂存 OAuth 参数到  │
     │                    │  Redis:               │
     │                    │  portal:auth_req:{sid}│
     │                    │  (TTL 5min)           │
     │  302 /login?       │                      │
     │  session_id=sid    │                      │
     │◄───────────────────┤                      │
     │                    │                      │
     │  4. 提交 Email+Password                   │
     │  POST /api/auth/login                     │
     │  { email, password, session_id: sid }     │
     ├───────────────────►│                      │
     │                    │  5. 校验凭证 + 签发   │
     │                    │  login_session JWT    │
     │                    │  (5min, ES256)        │
     │                    │                      │
     │  JSON { success,   │                      │
     │    redirect:        │                      │
     │    "/api/auth/      │                      │
     │    oauth2/authorize │                      │
     │    ?session_id=sid" │                      │
     │  }                 │                      │
     │  + Set-Cookie:      │                      │
     │    login_session    │                      │
     │◄───────────────────┤                      │
     │                    │                      │
     │  6. JS 导航到       │                      │
     │  /authorize?        │                      │
     │  session_id=sid     │                      │
     │  (Cookie 自动携带   │                      │
     │   login_session)    │                      │
     ├───────────────────►│                      │
     │                    │  7. 从 Redis 恢复     │
     │                    │  OAuth 参数            │
     │                    │  验 login_session     │
     │                    │  准入检查 + 签发 code │
     │                    ├─────────────────────►│
     │                    │◄─────────────────────┤
     │  302 /api/auth/    │                      │
     │  callback?code=xxx │                      │
     │  &state=xxx        │                      │
     │◄───────────────────┤                      │
     │                    │                      │
     │  8. GET /api/auth/  │                      │
     │  callback?code=xxx  │                      │
     │  Cookies:           │                      │
     │  pkce_verifier,     │                      │
     │  oauth_state,       │                      │
     │  oauth_nonce,       │                      │
     │  return_to          │                      │
     ├───────────────────►│                      │
     │                    │  9. 校验 state Cookie │
     │                    │  ↔ URL query 一致性   │
     │                    │  内部 POST /token     │
     │                    │  (code_verifier 独立  │
     │                    │   body 字段)          │
     │                    │  PKCE 验证通过        │
     │                    │  校验 nonce ↔         │
     │                    │  id_token.nonce       │
     │                    │  签发 AT + RT         │
     │                    │  清理 4 个临时 Cookie │
     │                    ├─────────────────────►│
     │                    │◄─────────────────────┤
     │  Set-Cookie:       │                      │
     │  portal_jwt_token  │                      │
     │  portal_refresh_   │                      │
     │  token             │                      │
     │  302 → return_to   │                      │
     │◄───────────────────┤                      │
```

**关键实现细节**:

- **步骤 1-2**: Gateway（Rust/Pingora）`request_filter` — 检测 HTML GET + 无 JWT + upstream 配置了 oauth → 生成 PKCE (code_verifier + code_challenge)、state (CSRF)、nonce (OIDC)、记录 return_to → Set-Cookie: 4 个 HttpOnly Cookie (Path=/api/auth/callback, TTL 5min) → 302 /authorize。PKCE 私钥全程在 HttpOnly Cookie 中，浏览器 JS 不可读。
- **步骤 3**: `apps/portal/src/app/api/auth/oauth2/authorize/route.ts` — authorize 端点。（分支 B：完整 query params）无登录会话时，将 OAuth 参数暂存 Redis (portal:auth_req:{sid}, TTL 5min) → 302 /login?session_id={sid}。（分支 A：带 session_id 参数）从 Redis 恢复参数 + 验 login_session → 签发 code → 一次性消费 Redis key。
- **步骤 4-6**: `apps/portal/src/app/api/auth/login/route.ts` — 当 body 包含 session_id 时，返回 JSON { success: true, redirect: "/api/auth/oauth2/authorize?session_id={sid}" } + Set-Cookie login_session。前端 JS 导航到 redirect URL。
- **步骤 8-9**: `apps/portal/src/app/api/auth/callback/route.ts` — 读 4 个 HttpOnly Cookie；state 校验（Cookie↔Query 一致性）；内部 POST /token（code_verifier 为独立 body 字段）；nonce 校验（id_token.nonce↔Cookie）；清除 4 个临时 Cookie；种 portal_jwt_token + portal_refresh_token。redirect 使用 return_to Cookie（不再复用 state）。

### 1.2 SSO 单点登录流程

子应用通过 Portal OIDC Provider 实现免登，关键区别在于用户已在 Portal 持有有效 `portal_jwt_token` Cookie。

```
┌─────────┐          ┌─────────┐          ┌──────────┐
│ 子应用   │          │ Portal  │          │ Portal   │
│ Browser  │          │         │          │  DB+Redis│
└────┬────┘          └────┬────┘          └────┬──────┘
     │                    │                     │
     │ 1. 子应用跳转至授权页                      │
     │ GET /api/auth/oauth2/authorize           │
     │ ?client_id=sub_app&redirect_uri=...      │
     │ &code_challenge=...&state=...            │
     ├───────────────────►│                     │
     │                    │ 2. 浏览器携带        │
     │                    │    portal_jwt_token  │
     │                    │    Cookie            │
     │                    │ 3. verifyAccessToken │
     │                    │    验签成功          │
     │                    │ 4. 跳过登录UI        │
     │                    │    直接签发授权码    │
     │                    ├────────────────────►│
     │                    │◄────────────────────┤
     │ 5. 302 → redirect_uri?code=...&state=... │
     │◄───────────────────┤                     │
     │                    │                     │
     │ 6. 子应用后端用code换token(back-channel)  │
```

**关键设计点**:

- authorize 端点优先尝试从 Cookie 读取 `portal_jwt_token` 进行验签（`verifyAccessToken()`）。验证通过则跳过登录 UI，直接执行授权码签发。该逻辑与 login_session 路径共存于同一个 authorize route handler：先尝试 JWT Cookie，不存在再尝试 login_session Cookie。
- SSO 流程依赖 `portal_jwt_token` 的有效性。Token 过期后需刷新或重新登录。
- 子应用（OAuth Client）必须预先在 Portal 注册，并配置正确的 redirect_uri、grant_type 和 scope。

### 1.3 Token 刷新流程

Access Token（1h）过期前 5 分钟，前端定时器触发静默刷新。

```
┌─────────┐              ┌─────────┐          ┌──────────┐
│ Browser │              │ Portal  │          │ DB+Redis │
└────┬────┘              └────┬────┘          └────┬──────┘
     │                        │                     │
     │ 1. 前端检测JWT exp<5min                      │
     │    POST /api/auth/refresh                    │
     │    携带 portal_refresh_token Cookie          │
     ├───────────────────────►│                     │
     │                        │ 2. getRefreshToken  │
     │                        │    FromCookie()     │
     │                        │ 3. rotateRefresh    │
     │                        │    Token()          │
     │                        │  a. 查DB验证RT有效  │
     │                        ├────────────────────►│
     │                        │◄────────────────────┤
     │                        │  b. 撤销旧RT        │
     │                        │  c. 签发新RT+AT     │
     │                        │  d. 重写权限缓存    │
     │                        │  e. 记录 login_log  │
     │                        │     (TOKEN_REFRESH) │
     │                        │                     │
     │ 4. Set-Cookie:         │                     │
     │    portal_jwt_token(新) │                     │
     │    portal_refresh_token(新)                   │
     │◄───────────────────────┤                     │
```

**关键实现细节**:

- **安全**: `rotateRefreshToken()` 执行 **Refresh Token Rotation**。每次刷新都签发新 RT，旧 RT 立即标记 `revoked`。
- **防重放**: 已撤销的 RT 被用于刷新时，触发**级联撤销**：该用户在该 Client 下的**所有** Refresh Token 均被标记 `revoked`。这防止了 RT 泄露后的重放攻击。
- **Cookie 路径隔离**: `portal_refresh_token` 的 Cookie path 设为 `/`，以便 Gateway 在全路径读取。Gateway 转发给 Portal 的非 /refresh 请求时会剥离此 Cookie，确保其仅在 Gateway 和 Portal 之间流动时对 Portal 只在 /refresh 端点可见。
- **失败处理**: RT 无效或过期时，记录 `login_log` (TOKEN_REFRESH_FAILED)，并清除所有 auth Cookie（`maxAge=0`），浏览器重定向到登录页。

### 1.4 登出流程

```
POST /api/auth/logout
  │
  ├─ 1. Access Token jti → Redis黑名单
  │     (Gateway离线验签实时拦截)
  │
  ├─ 2. Login Session Token jti → Redis黑名单
  │
  ├─ 3. Refresh Token → DB标记revoked
  │     (阻止refresh端点续期)
  │
  ├─ 4. 按用户ID撤销全部Refresh Token
  │     (防御纵深，杜绝遗漏)
  │
  ├─ 5. 记录 login_log (LOGOUT)
  │
  └─ 6. 清除三个Cookie:
       portal_jwt_token
       login_session
       portal_refresh_token
```

**四层撤销闭环**（`apps/portal/src/app/api/auth/logout/route.ts` + `lib/session/revoke.ts`）:

1. **Access Token jti 黑名单**: `revokeJti(jti, tokenExp)` 将 jti 写入 Redis `portal:jti_blocklist:{jti}`，TTL = token 剩余有效期。
2. **Login Session Token jti**: 同样写入 Redis 黑名单，防止竞态条件下被重放。
3. **Refresh Token 撤销**: DB 中对应行标记 `revoked = new Date()`。
4. **按用户 ID 全量撤销**: `revoke AllRefreshTokens(userId)` 确保无遗漏。同时 `revokeUserAccessByUserId(userId)` 通过 Redis Hash `portal:user_jti:{userId}` 读取该用户所有活跃 JTI，逐一写入黑名单。
5. **审计日志**: 写入 `login_logs` 表，`event_type = LOGOUT`。

**Cookie 清除**: 即使撤销操作失败（Redis/DB 异常），三个 Cookie 依然设置为 `maxAge=0`，保证客户端状态一致性。这是**失败安全（fail-secure）**设计。

**登出 API 同时支持 POST 和 GET**:
- `POST /api/auth/logout` - 返回 `{ success: true }` JSON，供前端 XHR 调用。
- `GET /api/auth/logout` - 执行同样的撤销逻辑后，302 重定向到 `/login`。

---

## 2. 鉴权体系详细设计

### 2.1 三层鉴权架构

鉴权体系分为三个层级，从页面渲染到 API 响应全覆盖：

| 层 | 位置 | 机制 | 失败行为 |
|---|------|------|---------|
| Layout | `app/(dashboard)/xxx/layout.tsx` | `requirePermission({ permissions: [...] })` | 返回 null，渲染 `<Forbidden />` |
| Server Action | `actions.ts` | `withAuth({ permissions: [...] }, handler)` | 返回 `{ success: false, error: 'FORBIDDEN' }` |
| API Route | `route.ts` | `withPermission({ permissions: [...] }, handler)` | 返回 `401` 或 `403` JSON |

**底层依赖链**:

```
requirePermission / withAuth / withPermission
  └─> checkPermission()
        ├─> resolveIdentity()   ← React.cache() 同请求去重
        │     ├─ Gateway信任路径: 读取 X-User-Id header (零验签)
        │     └─ JWT Cookie兜底: verifyAccessToken() 完整验签
        │
        └─ 角色/权限判定
              ├─ Admin角色(SUPER_ADMIN/ADMIN) → 直接放行
              ├─ requireAll模式 → 需要所有指定权限
              └─ 任意模式(默认) → 满足任一即可
```

### 2.2 resolveIdentity 身份解析

`apps/portal/src/lib/auth/verify-jwt.ts`

**双层策略**:

```
resolveIdentity()
  │
  ├─ [优先] Gateway信任路径
  │     读取 headers() → X-User-Id
  │     Gateway已完成ES256离线验签 + jti黑名单校验
  │     Portal信任此header → 零验签、零额外I/O
  │     同时从请求中解码JWT获取完整claims(不验签)
  │
  └─ [兜底] JWT Cookie验签
         getJwtFromCookie() → verifyAccessToken()完整验签
         适用于本地开发无Gateway、OAuth外部端点
```

**关键设计**:
- 使用 `React.cache()` 实现同请求去重。嵌套的 Server Component layout/page 多次调用 `resolveIdentity()` 时，仅在首次执行，后续命中缓存。
- 不 `catch` `headers()` 或 `cookies()` 的异常——构建期 prerendering 中断信号需要自然传播到 `<Suspense>`边界。
- Gateway 信任路径下，即便从请求头中解码 JWT claims 失败（极端情况），仍然以 Gateway 注入的 `X-User-Id` 为准，使用最小 fallback claims（roles=[], permissions=[], deptIds=[]）。

### 2.3 requirePermission 布局守卫

`apps/portal/src/lib/auth/check-permission.ts` — `requirePermission` 函数

```typescript
export const requirePermission = cache(
  async (options: PermissionCheckOptions): Promise<string | null> => {
    const auth = await checkPermission(options);
    return auth.authorized && auth.userId ? auth.userId : null;
  },
);
```

- 基于 `React.cache()` 实现同请求去重。Layout 和 Page 各自调用时命中缓存，零额外开销。
- 返回 `null` 时，Layout 渲染 `<Forbidden />` 组件。
- 适用于页面级权限控制，如用户管理页面的 `user:list` 权限。

典型用法（`layout.tsx`）:
```typescript
export default async function UsersLayout({ children }) {
  const userId = await requirePermission({ permissions: ['user:list'] });
  if (!userId) return <Forbidden />;
  return <>{children}</>;
}
```

### 2.4 withAuth Server Action 守卫

`apps/portal/src/lib/auth/guard.ts` — `withAuth` 高阶函数

```typescript
export function withAuth<TArgs extends unknown[], TData>(
  options: PermissionCheckOptions,
  fn: (ctx: AuthContext, ...args: TArgs) => Promise<ApiResponse<TData>>
): (...args: TArgs) => Promise<ApiResponse<TData>>
```

**职责**:
1. 内部调用 `checkPermission(options)` 进行权限检查。
2. 鉴权通过后，将 `AuthContext`（包含 `userId`）注入业务函数。
3. 业务函数抛出的所有异常统一经 `mapDomainError()` 映射。
4. `checkPermission` 自身的异常同样经 `mapDomainError()` 兜底。

**返回值**:
- 鉴权失败: `{ success: false, error: 'FORBIDDEN', message: '权限不足' }`
- 鉴权通过: 业务函数的返回值（统一 `ApiResponse<T>` 类型）

### 2.5 withPermission API Route 守卫

`apps/portal/src/lib/auth/facade.ts` — `withPermission` 包装器

```typescript
export async function withPermission(
  options: PermissionCheckOptions,
  handler: (userId: string, claims: PortalJwtClaims) => Promise<NextResponse>
): Promise<NextResponse>
```

**职责**:
1. 调用 `checkPermission(options)` 进行鉴权。
2. 鉴权通过后将 `userId` 和 `claims` 注入 handler。
3. 鉴权失败返回统一 JSON 格式: `{ error: 'AUTH_SSO_1003', message: '权限不足' }`。
4. 500 级服务错误自动记录日志。

### 2.6 权限检查逻辑

`checkPermission()` 的判定流程:

1. **身份解析**: 调用 `resolveIdentity()`。返回 null 时直接返回 `{ authorized: false, statusCode: 401 }`。
2. **Admin 旁路**: 检查 `claims.roles` 是否包含 `ADMIN_ROLE_CODES`（`['SUPER_ADMIN', 'ADMIN']`）。命中则直接返回 `{ authorized: true }`，绕过所有权限检查。
3. **权限编码检查**（`options.permissions`）:
   - `requireAll = true`: 用户必须拥有所有指定权限。
   - `requireAll = false`（默认）: 用户拥有任一指定权限即可。
4. **角色编码检查**（`options.roles`）:
   - 与权限编码相同的 `requireAll` 逻辑。
5. **通过**: 返回 `{ authorized: true, userId, claims }`。

---

## 3. 数据范围过滤详细设计

> **v3.2 重构**：数据范围过滤从「5 种 dataScopeType 分支 + 3 个函数链」简化为「角色部门 ID 列表 + 子树展开」单一模型。旧函数 `getDataScopeFilter`、`applyDataScopeFilter`、`checkDataScope` 已废弃。详见 [RBAC_MODEL_REDESIGN.md](./RBAC_MODEL_REDESIGN.md)。

### 3.1 数据范围模型

数据访问公式：**权限 × 角色部门交集**。

- 用户能看到什么 = 其所拥有角色的权限并集
- 用户能在哪看到 = 其所拥有角色的所属部门（含子部门）的并集
- 每个角色必须属于一个部门（`roles.dept_id` NOT NULL）
- 部门 ID 通过角色 ID 即可拿到：`user → user_roles → roles.dept_id`

### 3.2 getUserRoleDeptIds 函数

`apps/portal/src/lib/auth/data-scope.ts` — `getUserRoleDeptIds(userId)`

**签名**:
```typescript
async function getUserRoleDeptIds(userId: string): Promise<string[]>
//   永远返回 string[]。空数组 = 无角色 → 无数据访问权限
```

**内部逻辑**:

1. 从 Redis/DB 获取用户权限上下文（优先 JWT claims 零 I/O 快速路径）
2. 通过 `user_roles` → `roles.dept_id` 收集用户所有角色的所属部门
3. 对每个 `dept_id`，通过物化路径 `ancestors LIKE 'deptId/%'` 查询子树
4. 返回去重后的部门 ID 列表

### 3.3 使用模式

**列表查询**（`data.ts` 中）:
```typescript
const deptIds = await getUserRoleDeptIds(userId);
if (deptIds.length === 0) return { data: [], pagination: { total: 0 } };
conditions.push(inArray(schema.users.deptId, deptIds));
```

**单资源校验**（写操作/读详情）:
```typescript
const deptIds = await getUserRoleDeptIds(userId);
if (!deptIds.includes(target.deptId)) {
  throw new EntityNotFoundError('Resource', targetId); // 不暴露存在性
}
```

### 3.4 子树展开实现

通过 `departments.ancestors` 物化路径替代递归 CTE：

```sql
-- 查询 deptId 及其所有子部门
SELECT id FROM departments
WHERE id = :deptId OR ancestors LIKE :deptId || '/%'
```

查询异常时故障安全降级为仅当前部门（`[deptId]`），Default-Deny 最小权限。

---

## 4. 缓存策略详细设计

### 4.1 Next.js 16 缓存组件

`next.config.ts` 中启用 `cacheComponents: true`，开启 Partial Prerendering (PPR)。

**适用规则**:
- 列表查询使用 `'use cache'` 指令 + `cacheTag()` + `cacheLife()`。
- 写操作后调用 `revalidatePath()` + `updateTag()` 触发失效。
- **严禁**在 `'use cache'` 作用域内访问 `cookies()` / `headers()` / `searchParams` — 动态值必须在缓存作用域外读取，作为参数传入。
- 所有访问 cookies/headers 的 Server Component 必须包裹 `<Suspense>` 边界。

**典型模式**:
```
Page (Server Component)
├── <Suspense fallback={<Skeleton />}>
│   └── <PageContent>  ← 访问 cookies/headers/searchParams
│       ├── 调用 data.ts 获取数据（'use cache'）
│       └── 渲染 Client Components
└── 静态壳（Header, Sidebar 等在 Suspense 外）
```

### 4.2 权限上下文缓存

**用途**: 缓存用户的角色、权限编码、角色部门 ID 列表（已展开子树），避免每次 API 请求都查询数据库。

**Key 结构**: `portal:user_perms:{userId}`
**Value**: JSON 序列化的 `UserPermissionContext`
**TTL**: 3600 秒（与 Access Token TTL 对齐）

**缓存生命周期**:
1. **写入时机**: Token 签发（login、refresh_token grant）时通过 `cacheUserPermissionContext()` 主动预填充。正常路径下用户请求总是 Redis 命中，零 DB 查询。
2. **读取时机**: `getUserPermissionContext()` 先读 Redis，未命中则查询数据库（Drizzle 嵌套 JOIN），回写 Redis。
3. **失效时机**:
   - 管理员修改用户角色/权限/部门后，调用 `refreshUserPermissionCache(userId)` 或 `clearUserPermissionCache(userId)`。
   - 批量操作使用 `clearUsersPermissionCache(userIds)`。
   - Redis key 的 TTL 到期后自动淘汰。
4. **故障降级**: Redis 连接异常时优雅降级为直接查询数据库，不影响核心鉴权业务。

### 4.3 jti 黑名单缓存

**用途**: 紧急撤销 JWT Token，防止已登出或封禁用户的 Token 继续使用。

**双层 Redis Key 设计**:

| Key 模式 | 用途 | TTL | 生命周期 |
|----------|------|-----|---------|
| `portal:jti_blocklist:{jti}` | jti 黑名单标记 | Token 剩余有效期 | Token 签入 → 撤销时写入 → 到期自动删除 |
| `portal:user_jti:{userId}` | userId→{jti: exp} Hash 映射 | Token 剩余有效期（与最高 TTL 对齐） | Token 签发时通过 `trackUserJti()` 写入 |

**操作场景**:
- **登出**: `revokeJti(jti, exp)` — 单个 jti 写入黑名单。
- **按用户撤销**: `revokeUserAccessByUserId(userId)` — 从 Hash 读取所有活跃 jti，批量写入黑名单，删除 Hash key。同时删除 DB 中该用户的 `access_tokens` 行。
- **校验**: `isJtiRevoked(jti)` — 检查是否存在对应 key。

**故障处理**:
- Redis 不可用时，`isJtiRevoked()` 返回 false（安全降级，放行请求）。
- Gateway 侧 Redis 故障同样采用 fail-open 策略，记录错误但不阻断用户流量。

### 4.4 JWKS 公钥缓存

**用途**: Gateway 离线验签时无需每次访问 DB 或 Portal，通过内存缓存 JWKS 公钥实现零 I/O 验签。

**实现**（`apps/gateway/src/jwks.rs`）:

```
JwksCache
├── keys: RwLock<HashMap<String, DecodingKey>>  // kid → DecodingKey
├── oidc_metadata: RwLock<Option<OidcMetadata>>  // OIDC Discovery元数据
└── client: reqwest::Client                       // 复用的HTTP客户端
```

**缓存刷新策略**:
- **首次加载**: 启动时通过 OIDC Discovery 获取 `jwks_uri`，拉取公钥集。最多重试 5 次（间隔 2 秒），失败则**退出进程**。
- **后台定时刷新**: 成功后每 300 秒刷新一次。通过 tokio 后台任务定时执行。
- **失败退避**: 刷新失败时，如果缓存中已有有效旧密钥，300 秒后重试；缓存为空时 10 秒后快速重试。
- **Issuer 校验**: 首次加载时交叉校验配置的 issuer 与 OIDC Discovery 返回的 issuer，不匹配则**退出进程**。

**Portal 侧内存缓存**（`apps/portal/src/lib/auth/token.ts`）:
- 进程内存缓存，TTL 300 秒（`KEY_CACHE_TTL_MS = 300_000`）。
- 支持多 key 共存（Map<kid, CachedSigningKey>），密钥轮换后旧 token 仍可验签。
- 进程级互斥锁防止冷启动时多个并发请求各自生成重复密钥对。

---

## 5. 错误处理详细设计

### 5.1 DomainError 类型体系

所有领域异常继承自 `DomainError` 基类，定义在 `apps/portal/src/domain/shared/errors.ts`。

```
DomainError (base)
├── EntityNotFoundError      → 实体不存在（404）
├── DuplicateEntityError     → 唯一性冲突（409）
├── BusinessRuleViolationError → 业务规则违反（422）
│
├── InvalidClientError       → Client无效/停用/密钥不匹配（401）
├── InvalidGrantError        → 授权码无效/过期/已使用（400）
├── PKCEVerificationError    → PKCE验证失败（400）
└── InvalidRedirectUriError  → 回调地址不匹配（400）
```

**设计原则**:
- Controller 层严禁手写 `instanceof` 分支错误处理（架构约束 R2）。
- 所有异常统一由 `mapDomainError()` 映射为 HTTP 语义。
- OAuth 2.1 协议错误使用标准 OAuth 错误码（`invalid_client`, `invalid_grant`, `invalid_request` 等）。

### 5.2 mapDomainError 映射表

`apps/portal/src/domain/shared/error-mapping.ts`

| DomainError | HTTP Status | Error Code |
|-------------|-------------|-----------|
| `EntityNotFoundError` | 404 | `ENTITY_NOT_FOUND` |
| `DuplicateEntityError` | 409 | `DUPLICATE_ENTITY` |
| `BusinessRuleViolationError` | 422 | `BUSINESS_RULE_VIOLATION` |
| `InvalidClientError` | 401 | `INVALID_CLIENT` |
| `InvalidGrantError` | 400 | `INVALID_GRANT` |
| `PKCEVerificationError` | 400 | `PKCE_VERIFICATION_FAILED` |
| `InvalidRedirectUriError` | 400 | `INVALID_REDIRECT_URI` |
| 其他 `DomainError` 子类 | 400 | `err.code` |
| 未知异常 | 500 | `AUTH_SSO_1006` (INTERNAL_ERROR) |

**Prerendering 信号处理**: Next.js 构建期（静态预渲染/PPR）的中断信号会被 `mapDomainError()` 识别并返回 500（信号会自然传播到 `<Suspense>` 边界，非真正的运行时错误）。

### 5.3 统一错误响应格式

**Controller 层统一返回值类型**（`@auth-sso/contracts` 定义 `ApiResponse<T>`）:

```typescript
type ApiResponse<T> =
  | { success: true; data: T; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }
  | { success: false; error: string; message: string };
```

**Server Action 响应示例**:
```json
// 成功
{ "success": true, "data": { "id": "uuid-xxx" } }

// 失败
{ "success": false, "error": "DUPLICATE_ENTITY", "message": "User 的 username 已存在" }
```

**API Route 响应示例**:
```json
// 鉴权失败
{ "error": "AUTH_SSO_1003", "message": "权限不足" }

// 参数校验失败
{ "success": false, "error": "VALIDATION_ERROR", "message": "Invalid email" }
```

**OAuth 协议端点响应**（遵循 RFC 6749）:
```json
{ "error": "invalid_grant", "error_description": "授权码已被使用" }
```

---

## 6. Gateway 详细设计

### 6.1 请求处理流水线

Gateway 基于 Pingora (0.8.0)，是一个反向代理 + 安全网关，提供 HTTPS 入口和离线 JWT 验证。

```
请求到达
  │
  ├─ HTTP(80) → RedirectService → 301重定向到HTTPS
  │
  └─ HTTPS(443) → Gateway Proxy
       │
       ├─ 1. request_filter()
       │      ├─ 路径白名单匹配 → 放行
       │      ├─ 提取Cookie: portal_jwt_token
       │      ├─ Cookie不存在 → handle_auth_failure()
       │      └─ Cookie存在 → verify_jwt()
       │             ├─ decode_header提取kid
       │             ├─ JWKS缓存查找公钥
       │             ├─ ES256验签 + issuer校验
       │             ├─ jti黑名单检查(Redis fail-open)
       │             └─ 验证失败 → handle_auth_failure()
       │
       ├─ 2. upstream_request_filter()
       │      ├─ 注入 X-Forwarded-Proto/Host
       │      ├─ 零信任清洗：无条件剥离所有 X-* 身份头
       │      │     （黑名单兜底，仅放行 X-Forwarded-*/X-Request-Id/X-Correlation-Id/X-Real-IP）
       │      ├─ 按验签结果权威注入身份头（Authorization/X-User-Id/X-User-Jti/X-Client-IP/X-Client-UA）
       │      └─ 按路径分类重写上行 Cookie（微服务剥除全部 / 受保护路径剥除 RT）
       │
       └─ 3. upstream_peer()
              ├─ Router.resolve(path) → 按 name 长度最长前缀匹配 [[upstreams]] 路由表（name 即 prefix）
              └─ 从选定 LoadBalancer<RoundRobin> 取节点
                 （未匹配任何前缀时 fallback 到最短前缀 upstream，通常为 `/`）
```

### 6.2 Gateway OAuth 2.1 Client 层

**v5.2 新增** — Gateway 统一承担所有下游应用的 OAuth Client 职责，下游应用零 OAuth 代码。

**PKCE 生成与 /authorize 重定向**：

```
1. [浏览器]     GET /dashboard（无 JWT）
2. [Gateway]    检测 HTML GET + 无 JWT + upstream 配置了 oauth
                  |- 生成 PKCE (code_verifier + code_challenge)
                  |- 生成 state (CSRF) + nonce (OIDC)
                  |- Set-Cookie: pkce_verifier + oauth_state + oauth_nonce + return_to
                  |- 302 → /api/auth/oauth2/authorize?client_id=xxx&code_challenge=...
```

**OAuth callback 拦截**（仅对非 OIDC Provider 的 upstream 生效）：

Portal 自身作为 OIDC Provider，callback 由 Portal 的 `/api/auth/callback` 端点自行处理。Gateway 仅拦截**第三方下游应用**（如 ERP、CRM）的 callback——当 upstream 配置了 `oauth.client_secret` 时：

```
7. [Gateway]    GET {callback_path}?code=xxx&state=xxx
                  |- ① CSRF 校验：Cookie.oauth_state == Query.state
                  |- ② 提取 PKCE verifier（Cookie）
                  |- ③ 提取 nonce（Cookie）
                  |- ④ POST /api/auth/oauth2/token（code_verifier 为独立 body 字段）
                  |- ⑤ 校验 id_token.nonce == Cookie.nonce
                  |- ⑥ Set-Cookie: portal_jwt_token + portal_refresh_token
                  |- ⑦ Clear 4 个临时 OAuth Cookie（maxAge=0）
                  |- ⑧ 302 → return_to
```

未配置 secret 时 callback 透传，Gateway 注入 `X-OAuth-Code-Verifier` header 供下游自行完成 token 交换。

**Gateway 配置模型**：

```toml
[[upstreams]]
name = "/erp/"
addresses = "erp:3000"
# Gateway 代为执行 OAuth 2.1 Client 全流程
[upstreams.oauth]
client_id = "erp-app"
client_secret = "$ERP_CLIENT_SECRET"   # 有 secret → Gateway 代换 token
callback_path = "/api/auth/callback"   # 默认值，可不写
```

`apps/gateway/src/gateway.rs` — `verify_jwt()` 方法:

1. **解析 JWT Header**: `decode_header(token)` 提取 `kid`。若缺少 `kid`，拒绝。
2. **查找公钥**: 通过 `kid` 从 `JwksCache` 获取对应 `DecodingKey`。若未找到，拒绝。
3. **ES256 验签**: `jsonwebtoken::decode::<Claims>(token, &decoding_key, &validation)`:
   - `validation.algorithms` 取自 OIDC Discovery 的 `id_token_signing_alg_values_supported`，默认 `ES256`。
   - `validation.set_issuer()` 校验 `iss` 与配置的 issuer 一致。
   - `validate_aud = false` — Gateway 仅校验签名与 issuer，aud 交由 Portal 自行校验。
4. **jti 黑名单检查**: Redis `EXISTS portal:jti_blocklist:{jti}`。Redis 不可用时**故障开放（fail-open）**——记录错误但不阻断请求。
5. **通过**: 将 `Authorization: Bearer <token>`、`X-User-Id`、`X-User-Jti`、`X-Client-IP`、`X-Client-UA` 注入到上游请求。

**handle_auth_failure()** 根据请求类型决定响应:
- **浏览器 GET 页面导航**（`Accept: text/html`，无 RSC header）: 302 重定向到 `/login?callbackUrl=...`
- **API / RSC / Server Action 请求**: 返回 401 + `WWW-Authenticate: Bearer`

### 6.3 JWKS 缓存与刷新

`apps/gateway/src/jwks.rs` — `JwksCache`

**初始化流程**（`apps/gateway/src/main.rs`）:

1. 通过 `OIDC Discovery` 获取 `/.well-known/openid-configuration`，提取 `jwks_uri` 和 `issuer`。
2. 从 `jwks_uri` 拉取 JWKS 公钥集。
3. 将每个 JWK 按 `kid` 存入 `HashMap<String, DecodingKey>`。
4. 缓存 OIDC 元数据（用于动态算法选择和 issuer 交叉校验）。
5. Issuer 校验：配置值必须与 OIDC Discovery 返回值一致。

**后台刷新任务**（`start_background_refresh()`）:

```
tokio::spawn async {
  sleep(1s)  // 错开冷启动
  loop {
    match self.refresh(&upstream).await {
      Ok(_)    => sleep(300s),  // 标准间隔
      Err(e)   => {
        if has_keys { sleep(300s) }  // 有旧密钥兜底，标准退避
        else       { sleep(10s)  }   // 缓存为空，快速重试
      }
    }
  }
}
```

### 6.4 路径白名单

`apps/gateway/src/gateway.rs` — `PathMatcher`

路径匹配分为严格精确匹配（`HashSet` O(1) 查找）和前缀匹配（排序后遍历）。运行时通过配置文件 `gateway.toml` 中的 `public_paths` 定义。

**Gateway 侧白名单**:

| 路径 | 处理方式 | 说明 |
|------|---------|------|
| `/login` | 精确放行 | 登录页面 |
| `/register` | 精确放行 | 注册页面（预留） |
| `/error` | 精确放行 | 错误页面 |
| `/` | 精确放行 | 首页 |
| `/api/auth/` | 前缀放行 | OAuth 端点（login, token, jwks 等） |
| `/oauth2/` | 前缀放行 | OAuth 协议路径 |
| `/.well-known/` | 前缀放行 | OIDC Discovery |
| `/_next/` | 前缀放行 | Next.js 静态资源 |
| `/static/` | 前缀放行 | 静态资源 |
| `*.js, *.css, *.png` 等 | 扩展名放行 | 静态资产文件 |

**Portal 侧中间件白名单**（`proxy.ts`）:

```
PUBLIC_PATHS:  /login, /oauth, /.well-known
PUBLIC_API:    /api/auth/login, /api/auth/jwks, /api/auth/oauth2
SKIP_PREFIXES: /_next, /favicon, /images, /fonts
```

**白名单差异说明**: Gateway 侧对 `/*` 和 `/api/*` 有更细分的处理（微服务路由 vs Portal 路由）。Portal 的 proxy.ts 放行所有 `/api/` 路径（包括管理 API），因为 API 层自身有鉴权逻辑。

---

## 7. 安全设计要点

### 7.1 三层防御架构

| 层 | 组件 | 职责 | 失败模式 |
|----|------|------|---------|
| 边缘 | Gateway (Rust/Pingora) | JWT ES256 签名验证、jti 黑名单检查、Cookie 剥离、**PKCE 生成 + 回调拦截** | 302 /authorize 或 401 |
| 路由 | proxy.ts | Cookie 存在性检查、路径白名单 | 302 /login |
| 应用 | resolveIdentity + withAuth / requirePermission / withPermission | JWT 验签（无 Gateway 时）、权限编码校验 | 401/403 JSON 或 Forbidden 组件 |

**防御流程**:
1. Gateway 验证 JWT 签名 → 通过后注入 `X-User-Id` → Portal 信任此 header 免验签。无 JWT 时 Gateway 统一生成 PKCE → 302 /authorize。
2. Portal proxy.ts 仅做 Cookie 存在性兜底检查（Gateway 已处理 PKCE 链路）。
3. API/Server Action 层进行精细权限编码校验。

### 7.2 密钥管理

**密钥对生命周期**（`apps/portal/src/lib/auth/token.ts`）:

- **算法**: ES256 (ECDSA P-256)
- **存储**: PostgreSQL `jwks` 表
  - `private_key`: JWK 格式私钥 JSON 字符串
  - `public_key`: JWK 格式公钥 JSON 字符串
  - `kid`: 16 位密钥标识，写入 JWT header.kid，验签方据此定位公钥
  - `expires_at`: 90 天后过期
- **首次生成**: 表为空时自动生成密钥对。
- **自动轮换**: 当前活跃密钥超过 90 天时，生成新密钥并存为活跃密钥。旧密钥保留在表中，通过 kid 可继续验签旧 token。
- **多 key 共存**: Portal 的内存缓存和 Gateway 的 JWKS 缓存均支持多 kid 查找，确保轮换过渡期无令牌验证中断。
- **并发安全**: 串行化密钥生成，通过进程级互斥锁防止冷启动时多个请求各自生成重复密钥对。

### 7.3 Token 安全

| Token | 签名/存储 | 生命周期 | 安全特性 |
|-------|-----------|---------|---------|
| Login Session Token | ES256 JWT | 5 分钟 | 路径隔离 Cookie（`/api/auth/oauth2/authorize`） |
| Access Token | ES256 JWT | 1 小时 | 含完整 claims（roles, permissions, deptIds），jti 防重放 |
| ID Token | ES256 JWT | 1 小时 | OIDC Core 1.0 标准，含 nonce 防重放（OAuth 授权请求传入时写入） |
| Refresh Token | Opaque (DB 存储；设计目标 SHA-256，当前实现为明文，见 DATABASE §4.4 技术债) | 7 天 | Token Rotation + 重用检测（级联撤销）、路径隔离 Cookie |
| 授权码 | Opaque (DB) | 5 分钟 | 一次性使用（used 标记），PKCE S256 强制绑定 code_challenge |

### 7.4 Cookie 安全

所有认证 Cookie 遵循以下配置:

| Cookie | Path | HttpOnly | Secure | SameSite | 用途 |
|--------|------|----------|--------|----------|------|
| `portal_jwt_token` | `/` | true | 生产环境 | Lax | 认证主 Cookie（ES256 JWT，1h） |
| `portal_refresh_token` | `/` | true | 生产环境 | Lax | 静默续签（path=`/` 以便 Gateway 在全路径读取；Gateway 转发时剥离） |
| `login_session` | `/api/auth/oauth2/authorize` | true | 生产环境 | Lax | 登录→authorize 临时桥接（ES256 JWT，5min，一次性消费） |
| `pkce_verifier`（临时） | `/api/auth/callback` | true | 生产环境 | Lax | PKCE code_verifier（OAuth Client 生成，callback 读取后传给 /token） |
| `oauth_state`（临时） | `/api/auth/callback` | true | 生产环境 | Lax | CSRF state 随机值（callback 校验 Cookie↔Query 一致性后清除） |
| `oauth_nonce`（临时） | `/api/auth/callback` | true | 生产环境 | Lax | OIDC nonce（callback 校验 id_token.nonce↔Cookie 一致性后清除） |
| `return_to`（临时） | `/api/auth/callback` | true | 生产环境 | Lax | 登录后回跳路径（callback 经 safeRedirectPath 消毒后跳转） |

**Secure 降级**: 本地开发（`localhost`/`127.0.0.1`）时 `secure` 设为 `false`，允许 HTTP 直连。

---

## 8. 密钥与 Token 管理

### 8.1 JWKS 密钥生命周期

```
┌──────────────┐
│ 首次启动      │ → jwks表为空 → generateAndPersistKeyPair()
│ (冷启动)      │               → 生成ES256密钥对
└──────┬───────┘               → kid+publicKey+privateKey写入DB
       │                       → 写入进程内存缓存
       v
┌──────────────┐
│ 每次签发Token │ → getActiveSigningKey()
│              │    ├─ DESC排序取最新密钥
│              │    ├─ 检查expiresAt是否过期
│              │    └─ 过期 → 生成新密钥对（维持旧密钥在表中）
│              │
│ 每次验签Token │ → getSigningKeyByKid(kid)
│              │    ├─ 进程缓存命中 → 零DB
│              │    └─ Miss → 查DB jwks表 → 写入缓存
└──────┬───────┘
       v
┌──────────────┐
│ JWK端点公开   │ → GET /.well-known/jwks
│              │ → GET /api/auth/jwks
│              │   返回 { keys: [ { kty, crv, x, y, kid, alg } ] }
└──────────────┘
```

**Gateway 消费流程**:
```
OIDC Discovery → jwks_uri → JWKS拉取 → kid → DecodingKey → 内存缓存
                                                    ↑
                                        始建: 等待首次刷新成功(5次重试)
                                        刷新: 后台每300s定时刷新
                                        出⼝: 首次失败退出进程
```

### 8.2 Token 类型

| Token | 存储 | 签发 | 验签 | 撤销 |
|-------|------|------|------|------|
| Login Session JWT | `login_session` Cookie | `signLoginSession()` | `verifyAccessToken()` | Redis jti 黑名单 |
| Access Token JWT | `portal_jwt_token` Cookie | `signAccessToken()` | `verifyAccessToken()` | Redis jti 黑名单 + 可选的 `access_tokens` 表 |
| ID Token JWT | Token 端点 JSON 响应体 | `signIdToken()` | 客户端自行验签 | 通过 Access Token 绑定 |
| Refresh Token | `portal_refresh_token` Cookie | `issueRefreshToken()` | DB 查询 + 状态校验 | DB `revoked` 标记 |

### 8.3 紧急撤销机制

当需要立即让用户的 Token 失效（密码修改、账号封禁、强制下线）时:

**单 Token 撤销** (登出):
1. `revokeJti(jti, tokenExp)` — jti 写入 Redis 黑名单，TTL = token 剩余有效期。
2. `revokeUserToken(accessToken)` — 解码 jti 后撤销 + 删除 `access_tokens` 表对应行。

**按用户 ID 全量撤销**（管理员操作）:
1. `revokeAllRefreshTokens(userId)` — DB 中该用户所有 RT 标记 `revoked`。
2. `revokeUserAccessByUserId(userId)`:
   - 从 Redis Hash `portal:user_jti:{userId}` 读取所有活跃 jti→exp 映射。
   - 每个 jti 写入黑名单 `portal:jti_blocklist:{jti}`（精确 TTL）。
   - 删除 `portal:user_jti:{userId}` Hash key。
   - 删除 `access_tokens` 表对应行（异步，失败不阻断）。
3. `clearUserPermissionCache(userId)` — 删除权限缓存，使下次请求重新从 DB 加载。

---

## 9. OIDC Provider 端点

所有端点为**纯自定义实现**（无第三方 OIDC 库），基于 `jose` 库的 JWT 能力。实现为 Next.js Route Handlers。

| 端点 | 方法 | 路径 | 规范 | 文件 |
|------|------|------|------|------|
| Authorization | GET | `/api/auth/oauth2/authorize` | OAuth 2.1 Authorization Code + PKCE | `app/api/auth/oauth2/authorize/route.ts` |
| Token | POST | `/api/auth/oauth2/token` | Token 交换与刷新（RFC 6749） | `app/api/auth/oauth2/token/route.ts` |
| UserInfo | GET | `/api/auth/oauth2/userinfo` | OIDC UserInfo (OpenID Connect Core 1.0) | `app/api/auth/oauth2/userinfo/route.ts` |
| Introspection | POST | `/api/auth/oauth2/introspect` | Token  introspection (RFC 7662) | `app/api/auth/oauth2/introspect/route.ts` |
| Revocation | POST | `/api/auth/oauth2/revoke` | Token revocation (RFC 7009) | `app/api/auth/oauth2/revoke/route.ts` |
| JWKS | GET | `/api/auth/jwks` | 公钥集（JWK Set Format） | `app/api/auth/jwks/route.ts` |
| Callback | GET | `/api/auth/callback` | Portal BFF OAuth 回调处理 | `app/api/auth/callback/route.ts` |
| Login | POST | `/api/auth/login` | 邮箱/密码凭证验证 | `app/api/auth/login/route.ts` |
| Logout | POST/GET | `/api/auth/logout` | 登出 + Token 撤销 | `app/api/auth/logout/route.ts` |
| Refresh | POST | `/api/auth/refresh` | Token 刷新（Rotation） | `app/api/auth/refresh/route.ts` |
| Discovery | GET | `/.well-known/openid-configuration` | OIDC Discovery（OpenID Connect Discovery 1.0） | `app/.well-known/openid-configuration/route.ts` |
| JWKS | GET | `/.well-known/jwks` | OIDC 标准 JWKS 端点 | `app/.well-known/jwks/route.ts`（如果存在） |

---

## 10. 附录

### 附录 A: 关键函数签名参考

以下签名从实际代码提取，反映运行时真实类型。

**Auth 核心** (`apps/portal/src/lib/auth/token.ts`):

```typescript
export async function signLoginSession(userId: string): Promise<string>
export async function signAccessToken(
  claims: Pick<PortalJwtClaims, 'sub' | 'roles' | 'permissions' | 'deptIds'>,
  audience: string = 'portal-client',
  persist?: { clientId: string; scopes?: string },
): Promise<{ token: string; jti: string }>
export async function signIdToken(params: {
  userId: string; clientId: string; nonce?: string | null; authTime: Date;
}): Promise<string>
export async function verifyAccessToken(token: string): Promise<PortalJwtClaims | null>
export async function issueRefreshToken(userId: string, clientId: string, scopes?: string): Promise<string>
export async function rotateRefreshToken(oldRefreshToken: string, clientId: string): Promise<RefreshTokenResult | null>
export async function revokeAllRefreshTokens(userId: string): Promise<void>
```

**身份解析** (`apps/portal/src/lib/auth/verify-jwt.ts`):

```typescript
export const resolveIdentity: () => Promise<ResolvedIdentity | null>
```

**鉴权守卫** (`apps/portal/src/lib/auth/guard.ts` + `facade.ts` + `check-permission.ts`):

```typescript
export function withAuth<TArgs extends unknown[], TData>(
  options: PermissionCheckOptions,
  fn: (ctx: AuthContext, ...args: TArgs) => Promise<ApiResponse<TData>>
): (...args: TArgs) => Promise<ApiResponse<TData>>

export async function withPermission(
  options: PermissionCheckOptions,
  handler: (userId: string, claims: PortalJwtClaims) => Promise<NextResponse>
): Promise<NextResponse>

export async function checkPermission(options: PermissionCheckOptions): Promise<PermissionCheckResult>

export const requirePermission: (options: PermissionCheckOptions) => Promise<string | null>
```

**数据范围** (`apps/portal/src/lib/auth/data-scope.ts`):

```typescript
// v3.2: 单一函数替代旧的三函数链
export async function getUserRoleDeptIds(userId: string): Promise<string[]>
//   永远返回 string[]，部门 ID 通过 user → user_roles → roles.dept_id 获取
//   空数组 = 无角色 → 无数据访问权限
```

**权限上下文** (`apps/portal/src/lib/permissions.ts`):

```typescript
export async function getUserPermissionContext(userId: string): Promise<UserPermissionContext | null>
export async function cacheUserPermissionContext(userId: string, ctx: UserPermissionContext, ttl?: number): Promise<void>
export async function refreshUserPermissionCache(userId: string): Promise<void>
export async function clearUserPermissionCache(userId: string): Promise<void>
export async function clearUsersPermissionCache(userIds: string[]): Promise<void>
```

**Cookie/Session 工具** (`apps/portal/src/lib/session/cookies.ts` + `jwt.ts`):

```typescript
export async function getJwtFromCookie(): Promise<string | null>
export async function getRefreshTokenFromCookie(): Promise<string | null>
export function setJwtCookies(response: NextResponse, accessToken: string, refreshToken?: string, accessTokenExpiresIn?: number): void
export function clearJwtCookies(response: Response): void
export function decodeJwtPayload(token: string): PortalJwtClaims | null
```

**撤销机制** (`apps/portal/src/lib/session/revoke.ts`):

```typescript
export async function revokeJti(jti: string, tokenExp: number): Promise<void>
export async function isJtiRevoked(jti: string): Promise<boolean>
export async function trackUserJti(userId: string, jti: string, ttl: number): Promise<void>
export async function revokeUserAccessByUserId(userId: string): Promise<number>
export async function revokeUserToken(accessToken: string): Promise<void>
```

**Domain 纯函数** (`apps/portal/src/domain/auth/`):

```typescript
// login.ts
export function validateLoginCredentials(row: UserAuthRow): void

// password.ts
export async function hashPassword(raw: string): Promise<string>
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean>

// oauth-authorize.ts
export function validateAuthorization(input: AuthorizeUserInput): AuthorizationResult
export function checkUserClientAccess(input: AuthorizationInput): AuthorizationResult

// oauth-code.ts
export function validateAuthCodeRow(row: AuthCodeRow | undefined, redirectUri?: string): void
export async function verifyPKCE(codeVerifier: string, codeChallenge: string): Promise<void>

// oauth-client.ts
export function validateClientActive(clientRow: { status: string } | undefined): void
export function validateClientSecret(client: { clientSecret: string | null }, providedSecret?: string): void
export function validateRedirectUri(redirectUris: string[], redirectUri: string): void
```

**Gateway** (`apps/gateway/src/`):

```rust
// gateway.rs
impl Gateway {
    async fn verify_jwt(&self, token: &str, ctx: &mut GatewayCtx) -> bool
    async fn handle_auth_failure(&self, session: &mut Session) -> Result<bool>
}

// jwks.rs
impl JwksCache {
    pub fn new() -> Arc<Self>
    pub fn get_key(&self, kid: &str) -> Option<DecodingKey>
    pub fn is_empty(&self) -> bool
    pub async fn refresh(&self, upstream: &str) -> Result<(), JwksError>
    pub fn start_background_refresh(self: Arc<Self>, rt: &tokio::runtime::Runtime, upstream: String)
    pub async fn discover_oidc_metadata(&self, upstream: &str) -> Result<OidcMetadata, JwksError>
    pub fn validate_issuer(&self, configured_issuer: &str) -> Result<(), JwksError>
    pub fn get_supported_algorithms(&self) -> Vec<Algorithm>
}

// redirect.rs
pub fn generate_redirect_location(host: &str, path: &str, query: Option<&str>, ssl_port: u16) -> String
```

**错误映射** (`apps/portal/src/domain/shared/`):

```typescript
// errors.ts - 领域错误类
export class DomainError extends Error { constructor(public code: string, message: string) }
export class EntityNotFoundError extends DomainError { constructor(entity: string, id: string) }
export class BusinessRuleViolationError extends DomainError { constructor(rule: string) }
export class DuplicateEntityError extends DomainError { constructor(entity: string, field: string) }
export class InvalidClientError extends DomainError { constructor(message?: string) }
export class InvalidGrantError extends DomainError { constructor(message: string) }
export class PKCEVerificationError extends DomainError { constructor(message?: string) }
export class InvalidRedirectUriError extends DomainError { constructor(message?: string) }

// error-mapping.ts
export function mapDomainError(err: unknown): { status: number; error: string; message: string }
```

**Crypto 工具** (`apps/portal/src/lib/crypto.ts`):

```typescript
export function generateId(length?: number): string
export function generateUUID(): string
export function generateClientId(): string
export function generateClientSecret(): string
export function hashToken(token: string): string
```

### 附录 B: 环境变量参考

| 变量名 | Zod 默认值 | 描述 |
|--------|-----------|------|
| `NODE_ENV` | `'development'` | 运行环境（development/production/test） |
| `DATABASE_URL` | （必填，Zod URL） | PostgreSQL 连接字符串 |
| `REDIS_URL` | `'redis://localhost:6379'` | Redis 连接字符串 |
| `LOG_LEVEL` | `'info'` | 日志级别（debug/info/warn/error） |
| `NEXT_PUBLIC_APP_NAME` | `'Auth-SSO Portal'` | Portal 应用名称 |
| `NEXT_PUBLIC_APP_URL` | `'http://localhost:4100'` | Portal 对外访问地址 |
| `PORTAL_CLIENT_SECRET` | 无 | Portal 自身作为 OAuth Client 的 secret |
| `BETTER_AUTH_URL` | 无 | 覆盖 `getAppBaseURL()` 返回值（兼容） |
| `PORTAL_ISSUER` | 无 | 覆盖 OIDC Provider issuer（无则取 APP_URL） |
| `PORTAL_JWKS_URI` | 无 | 覆盖 JWKS 端点 URL |
| `TRUSTED_ORIGINS` | 无 | 受信任来源域（逗号分隔，开发环境自动添加 localhost） |

**Gateway 配置** (`gateway.toml`):

| 配置项 | 默认值 | 描述 |
|--------|--------|------|
| `gateway.port` | `18080` | HTTP 监听端口（重定向到 HTTPS） |
| `gateway.ssl_port` | `18443` | HTTPS 监听端口 |
| `gateway.ssl_cert_path` | - | TLS 证书路径 |
| `gateway.ssl_key_path` | - | TLS 密钥路径 |
| `gateway.log_dir` | - | 日志目录 |
| `gateway.log_level` | `'info'` | 日志级别 |
| `redis.url` | - | Redis 连接 URL（用于 jti 黑名单） |

> JWT `issuer` 与签名算法**非配置项**，由 Gateway 启动时通过 OIDC Discovery（`/.well-known/openid-configuration`）从 `oidc_provider = true` 的 upstream 动态获取，写入 JWT 校验 `validation`。

**多 Upstream 路由表** (`[[upstreams]]`，name 即 path prefix，按长度降序最长前缀匹配):

| 配置项 | 必填 | 描述 |
|--------|------|------|
| `upstreams[].name` | 是 | 路径前缀，同时作为 upstream 标识（如 `/`、`/demo/`）。启动期校验唯一与非空 |
| `upstreams[].addresses` | 是 | 上游地址，逗号分隔多个节点做 RoundRobin 负载均衡（如 `127.0.0.1:4100,127.0.0.1:4101`） |
| `upstreams[].public_paths` | 否 | 该 upstream 的公开路径白名单；启动时跨所有 upstream 聚合为全局 `PathMatcher` |
| `upstreams[].oidc_provider` | 否 | 标记此 upstream 提供 JWKS 与 Token 续签端点；路由表内**有且仅有一个**为 `true`（启动期校验） |

---

> **本文档与 ARCHITECTURE.md 形成互补：ARCHITECTURE.md 描述系统架构全貌，本文档提供实现层面的详细设计。两者不一致时以本文档为准。**
