# OAuth 2.1 标准链路统一重构设计文档

**版本**: v1.1
**状态**: 草稿（已应用第 1 轮评审修订）
**日期**: 2026-07-08

> **v1.1 修订摘要**（基于评审反馈，6 项关键修订）：
> 1. `state` 改为随机值 + HttpOnly Cookie，回跳路径改用独立 `return_to` 参数（CSRF 真正生效）
> 2. 补全 `nonce` 生成与校验链路（OIDC Core 防重放）
> 3. **不新增 `portal_sso`**——复用现有 `login_session`（冷登录桥接）+ `portal_jwt_token`（SSO 免登判据），遵循最小改动原则
> 4. `callback` 详设：`code_verifier` 作为独立 body 字段（代码层已标准化，本方案延续）
> 5. 兼容期：明确 `login` 端点按 `session_id` 分流响应格式；步骤 2/4 原子上线
> 6. 安全分析如实标注「登录型 CSRF / 强制授权」残留风险

---

## 1. 动机

当前 Portal 存在两条分裂的认证链路：

| 链路 | PKCE 生成位置 | verifier 存储 | code_challenge 保护 |
|------|--------------|--------------|---------------------|
| Portal Admin UI 自登录 | 浏览器 JS (`login-form.tsx`) | `document.cookie`（非 HttpOnly） | ❌ XSS 可读 |
| 第三方 SSO 冷登录 | 第三方 SSR 服务端 | 第三方 HttpOnly Cookie | ✅ 但被 login-form 覆盖导致 PKCE 失败 |

根源：**登录表单跨越了 Client 和 AS 的角色边界**——同时承担"收集凭证"（AS 职责）和"生成PKCE/构造授权URL"（Client 职责）。

目标：**所有 Client（Portal 自身 + 第三方）遵循完全相同的 OAuth 2.1 标准链路**。

---

## 2. 角色分离

```
┌─────────────────────────────────────────────────────────┐
│                    Portal 进程                           │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Authorization Server (AS)                        │  │
│  │  · /api/auth/oauth2/authorize                     │  │
│  │  · /api/auth/oauth2/token                         │  │
│  │  · /api/auth/login                                │  │
│  │  · Redis: session_id → OAuth params               │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  OAuth Client (Portal Admin UI)                   │  │
│  │  · proxy.ts: 检测无 JWT → 生成 PKCE/state/nonce   │  │
│  │    → 种 4 个 HttpOnly Cookie → /authorize         │  │
│  │  · /api/auth/callback: 校验 state/nonce           │  │
│  │    → code→token 交换（PKCE 独立 body 字段）        │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Resource Server (Portal Admin API)               │  │
│  │  · resolveIdentity() → 消费 access_token           │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

关键原则：**Portal Admin UI 与第三方 SSR 应用在 OAuth 协议层面地位完全平等**。不存在"Portal 是 IDP 所以自登录可以走捷径"。

---

## 3. 统一标准链路（时序图）

```
══════════════════ 任何 Client（Portal or 第三方） ══════════════════════

   ┌──────────┐        ┌──────────────┐        ┌──────────────┐
   │ Browser  │        │ Client (SSR) │        │  AS (Portal) │
   └────┬─────┘        └──────┬───────┘        └──────┬───────┘
        │                     │                       │
        │ GET /dashboard      │                       │
        │────────────────────>│                       │
        │                     │                       │
        │                     │ ① 检测无会话            │
        │                     │ 生成 code_verifier     │
        │                     │ 计算 code_challenge     │
        │                     │ 生成 state (随机32B)    │
        │                     │ 生成 nonce (16B)        │
        │                     │ 记录 return_to          │
        │                     │                       │
        │                     │ 种 4 个 HttpOnly Cookie │
        │  Set-Cookie:        │ (path=/api/auth/       │
        │  pkce_verifier=xxx  │  callback, 5min):      │
        │  oauth_state=xxx    │  · pkce_verifier       │
        │  oauth_nonce=xxx    │  · oauth_state         │
        │  return_to=/dash    │  · oauth_nonce         │
        │                     │  · return_to           │
        │                     │                       │
        │  302 /authorize     │                       │
        │  ?client_id=portal  │                       │
        │  &redirect_uri=...  │                       │
        │  &code_challenge=S  │                       │
        │  &state=xxx         │                       │
        │  &nonce=xxx         │                       │
        │<────────────────────│                       │
        │                     │                       │
        │ GET /authorize?...  │                       │
        │─────────────────────────────────────────────>│
        │                     │                       │
        │                     │      ② 校验 client_id │
        │                     │      redirect_uri      │
        │                     │      检测无登录会话：    │
        │                     │      login_session?    │
        │                     │      portal_jwt_token? │
        │                     │      → 均无            │
        │                     │                       │
        │                     │      ③ 生成 session_id │
        │                     │      Redis SET:        │
        │                     │      portal:auth_req:  │
        │                     │      {sid} →           │
        │                     │      { client_id,      │
        │                     │        redirect_uri,   │
        │                     │        code_challenge, │
        │                     │        scope,          │
        │                     │        state,          │
        │                     │        nonce }         │
        │                     │      TTL: 5min         │
        │                     │                       │
        │  302 /login?        │                       │
        │  session_id=sid     │                       │
        │<─────────────────────────────────────────────│
        │                     │                       │
        │ GET /login?         │                       │
        │ session_id=sid      │                       │
        │─────────────────────────────────────────────>│
        │                     │                       │
        │                     │      ④ 渲染登录表单    │
        │                     │      (只看到 session_id│
        │                     │       零 OAuth 参数)   │
        │  登录页面 HTML      │                       │
        │<─────────────────────────────────────────────│
        │                     │                       │
        │  ⑤ 用户输入凭证     │                       │
        │  <form method="POST"│                       │
        │   action="/api/auth/│                       │
        │   login">           │                       │
        │   email+password    │                       │
        │   + hidden:         │                       │
        │     session_id=sid  │                       │
        │─────────────────────────────────────────────>│
        │                     │                       │
        │                     │      ⑥ 校验凭证       │
        │                     │      签发 login_session│
        │                     │      (5min, ES256 JWT) │
        │                     │                       │
        │  Set-Cookie:        │                       │
        │  login_session=xxx  │                       │
        │  302 /authorize?    │                       │
        │  session_id=sid     │                       │
        │<─────────────────────────────────────────────│
        │                     │                       │
        │ GET /authorize?     │                       │
        │ session_id=sid      │                       │
        │ Cookie: login_      │                       │
        │ session=xxx         │                       │
        │─────────────────────────────────────────────>│
        │                     │                       │
        │                     │      ⑦ Redis GET      │
        │                     │      portal:auth_req:  │
        │                     │      {sid} → params    │
        │                     │      验 login_session   │
        │                     │      清 login_session   │
        │                     │      业务准入检查        │
        │                     │      签发 auth_code     │
        │                     │      (绑定原始          │
        │                     │       code_challenge)   │
        │                     │      DEL Redis key      │
        │                     │                       │
        │  302 redirect_uri?  │                       │
        │  code=xxx&state=xxx │                       │
        │<─────────────────────────────────────────────│
        │                     │                       │
        │ GET /api/auth/      │                       │
        │ callback?code=xxx   │                       │
        │ Cookie: pkce_verifier                       │
        │        oauth_state                          │
        │        oauth_nonce                          │
        │        return_to                            │
        │────────────────────>│                       │
        │                     │                       │
        │                     │  ⑧ 校验 state         │
        │                     │  Cookie↔Query 比对    │
        │                     │  读 pkce_verifier      │
        │                     │                       │
        │                     │  POST /token           │
        │                     │  (服务端间)            │
        │                     │  body: code +          │
        │                     │  code_verifier         │
        │                     │────────────────────────>│
        │                     │                       │
        │                     │      ⑨ PKCE 校验      │
        │                     │      SHA256(verifier)  │
        │                     │      == code_challenge  │
        │                     │      签发 AT+RT+ID_Token│
        │                     │                       │
        │                     │  { access_token,       │
        │                     │    refresh_token,      │
        │                     │    id_token }          │
        │                     │<────────────────────────│
        │                     │                       │
        │                     │  ⑩ nonce 校验         │
        │                     │  id_token.nonce        │
        │                     │  == cookie nonce       │
        │                     │  清除 4 个临时 Cookie  │
        │                     │  建立自身会话           │
        │                     │                       │
        │  Set-Cookie (各Client自己的会话)            │
        │  302 → return_to    │                       │
        │<────────────────────│                       │
        │                     │                       │
        │ GET /dashboard      │                       │
        │ (携 Client 自身会话) │                       │
        │────────────────────>│                       │
        │                     │                       │
        │  渲染后的页面 HTML  │                       │
        │<────────────────────│                       │
```

> Portal 自身作为 Client 时，上述流程中的 Client SSR 层就是 `proxy.ts`（无 JWT 分支）。第三方 SSR 应用按各自框架实现相同的逻辑。

---

## 4. 数据模型变更

### 4.1 新增 Redis Key

```
Key: portal:auth_req:{session_id}
Type: JSON string
TTL: 300 (5 分钟，与 authorization_code 对齐)

JSON payload:
{
  "client_id": "string",              // OAuth client_id
  "redirect_uri": "string",           // 回调地址
  "code_challenge": "string",         // PKCE S256 challenge
  "code_challenge_method": "S256",    // 固定
  "scope": "string",                  // 授权范围
  "state": "string",                  // OAuth CSRF state（Client 生成，AS 透传）
  "nonce": "string|null"              // 可选 OIDC nonce
}
```

> 注意：`portal:auth_req:` 前缀用于暂存 OAuth 授权参数，与 `contracts/oidc.ts` 中已定义但未使用的 `portal:auth_code:` + `portal:pkce:` 前缀不同——后者为预留字段，当前不冲突。

### 4.2 新增 Cookie（Client 层——PKCE + nonce + state）

```
① pkce_verifier
   Scope: Path=/api/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=300
   Setter: Client SSR 层（Portal 为 proxy.ts，第三方为各自服务端）
   Reader: Client callback（Portal 为 /api/auth/callback，第三方为各自 callback）

② oauth_state
   Scope: Path=/api/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=300
   Setter: Client SSR 层（与 pkce_verifier 同位置）
   Reader: Client callback → 与 URL query 中的 state 比对，一致后清除

③ oauth_nonce
   Scope: Path=/api/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=300
   Setter: Client SSR 层（scope 含 openid 时必须生成）
   Reader: Client callback → 与 id_token.nonce 比对

④ return_to
   Scope: Path=/api/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=300
   Setter: Client SSR 层（目标回跳页面路径）
   Reader: Client callback → safeRedirectPath(return_to) 消毒后跳转
```

> **设计原则**: `state`（CSRF 防护）与 `return_to`（路由）职责分离。state 必须是随机值并做 Cookie→Query 一致性校验。

### 4.3 AS 自身 SSO 会话：沿用 `portal_jwt_token` + `login_session`，不新增

```
portal_jwt_token（Access Token）
→ authorize 端点已支持回退读取（当前代码 L57-60），覆盖已登录用户免登

login_session（5min, Path=/api/auth/oauth2/authorize）
→ 保留现有用途：从 POST /api/auth/login 到 GET /authorize 的临时桥接
→ 不改变 TTL 和 Path（最小暴露面设计，符合 ARCHITECTURE.md §7.2）
```

**不需要新增 `portal_sso`**：Access Token 本身就是 AS 的 SSO 会话判据（authorize 端点已实现）。冷登录由 login_session 桥接，无需第三种 Token。

### 4.4 合约层新增常量

```typescript
// packages/contracts/src/index.ts
export const COOKIE_NAMES = {
  JWT: 'portal_jwt_token',
  REFRESH: 'portal_refresh_token',
  LOGIN_SESSION: 'login_session',       // 保留
  PKCE_VERIFIER: 'pkce_verifier',       // 新增：PKCE verifier (Client HttpOnly)
  OAUTH_STATE: 'oauth_state',           // 新增：CSRF state (Client HttpOnly)
  OAUTH_NONCE: 'oauth_nonce',           // 新增：OIDC nonce (Client HttpOnly)
  RETURN_TO: 'return_to',               // 新增：回跳路径 (Client HttpOnly)
} as const;

// packages/contracts/src/oidc.ts
export const REDIS_KEY_PREFIX = {
  // ...existing...
  AUTH_REQUEST: 'portal:auth_req:',  // 新增：授权请求参数暂存
} as const;
```

---

## 5. 文件变更清单

### 5.1 合约层（零运行时依赖）

| 文件 | 变更 |
|------|------|
| `packages/contracts/src/index.ts` | `COOKIE_NAMES` 新增 `PKCE_VERIFIER`、`OAUTH_STATE`、`OAUTH_NONCE`、`RETURN_TO` |
| `packages/contracts/src/oidc.ts` | `REDIS_KEY_PREFIX` 新增 `AUTH_REQUEST` |

### 5.2 AS 层

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/app/api/auth/oauth2/authorize/route.ts` | **重构** | 新增 session_id 分支：Redis 恢复参数 + login_session 校验；保留现有 Cookie 直读路径（SSO 免登） |
| `src/app/api/auth/login/route.ts` | **改造** | 接收 `session_id` 字段；存在时返回 302 + Set-Cookie login_session，否则保持 JSON 兼容 |
| `src/lib/oauth-utils.ts` | **改造** | `buildLoginRedirect` → `buildLoginPageRedirect(appBaseUrl, sessionId)`；移除 OAuth 参数 URL 拼接 |
| `src/lib/session/auth-request-store.ts` | **新增** | Redis 读写 `portal:auth_req:`（storeAuthRequest / getStoredAuthRequest / deleteStoredAuthRequest） |
| `src/domain/auth/types.ts` | **追加** | 新增 `StoredAuthRequest` 接口 |

### 5.3 Client 层（Portal Admin UI）

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/proxy.ts` | **改造** | 无 JWT → 生成 PKCE + state + nonce → 种 4 个 HttpOnly Cookie → 302 /authorize?client_id=portal&... |
| `src/app/login/login-form.tsx` | **简化** | 移除全部 OAuth/PKCE 逻辑；改用原生 `<form method="POST" action="/api/auth/login">`；只传递 session_id |
| `src/app/login/page.tsx` | **简化** | 移除 code_challenge 等 OAuth 参数读取；只接收 session_id 和 error |
| `src/app/api/auth/callback/route.ts` | **增强** | state 改为 Cookie↔Query 一致性校验；新增 nonce↔ID Token 校验；从 Cookie 读 return_to |

### 5.4 公共

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/lib/auth/pkce.ts` | **调用方变更** | 调用方从浏览器 JS 变为 server-side（proxy.ts） |

---

## 6. 关键接口变更详设

### 6.1 `GET /api/auth/oauth2/authorize`

**before:**
```
未登录 → 302 /login?client_id=xxx&redirect_uri=xxx&code_challenge=xxx&scope=xxx&state=xxx&nonce=xxx
已登录 → 读 login_session Cookie 或 portal_jwt_token → 签发 code → 302 redirect_uri
```

**after:**
```
┌─ 分支 A：带 session_id 参数（登录后回跳）
│  → Redis GET portal:auth_req:{sid} → 恢复 params
│  → 读 login_session Cookie 验签（登录端点刚写入）
│  → 签发 code（绑定恢复的 code_challenge）→ DEL Redis key → 302 redirect_uri
│
├─ 分支 B：带完整 OAuth query params（首次授权）
│  → 校验 client_id、redirect_uri
│  → 尝试读 login_session Cookie 或 portal_jwt_token Cookie
│  │  ├─ 有效会话 → 直接签发 code → 302 redirect_uri
│  │  └─ 无会话 → Redis SET portal:auth_req:{sid} → 302 /login?session_id={sid}
│
└─ 两种分支最终都走到同一个签发路径（生成 auth_code → 写入 DB → 302 callback）
```

伪代码：

```typescript
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  // 分支 A：登录后回跳（携带 session_id）
  if (sessionId) {
    const stored = await getStoredAuthRequest(sessionId);
    if (!stored) {
      return buildOAuthErrorRedirect(request, 'session_expired', '授权会话已过期，请重新发起授权');
    }
    await deleteStoredAuthRequest(sessionId);

    // 读 login_session Cookie（登录端点刚写入，5min 窗口内）
    const loginSession = request.cookies.get(COOKIE_NAMES.LOGIN_SESSION)?.value;
    if (!loginSession) {
      return buildLoginPageRedirect(appBaseURL, sessionId); // 重新登录
    }
    const sessionClaims = await verifyAccessToken(loginSession);
    if (!sessionClaims) {
      return buildLoginPageRedirect(appBaseURL, sessionId);
    }
    clearLoginSessionCookie(response); // 一次性消费

    // 恢复参数 → 校验 Client → 签发 code
    const parsed = AuthorizeQuerySchema.safeParse(stored);
    if (!parsed.success) return buildOAuthErrorRedirect(request, 'invalid_request', '...');
    const client = await getClientByClientId(parsed.data.client_id);
    validateClientActive(client);
    validateRedirectUri(client!.redirectUris, parsed.data.redirect_uri);
    // ... 准入检查 + 签发 code（复用现有逻辑）...
    return issueCodeAndRedirect(parsed.data, sessionClaims.sub);
  }

  // 分支 B：首次授权请求（完整 query params）
  const parsed = AuthorizeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return buildOAuthErrorRedirect(request, 'invalid_request', '...');

  const { client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method } = parsed.data;
  const client = await getClientByClientId(client_id);
  validateClientActive(client);
  validateRedirectUri(client!.redirectUris, redirect_uri);

  // 尝试已有会话（login_session > portal_jwt_token）
  const loginSession = request.cookies.get(COOKIE_NAMES.LOGIN_SESSION)?.value
    || request.cookies.get(COOKIE_NAMES.JWT)?.value;
  const sessionClaims = loginSession ? await verifyAccessToken(loginSession) : null;

  if (sessionClaims) {
    // 已登录 → 直接签发（SSO 免登）
    return issueCodeAndRedirect(parsed.data, sessionClaims.sub);
  }

  // 未登录 → 存 Redis → 302 /login?session_id
  const sid = crypto.randomUUID();
  await storeAuthRequest(sid, {
    client_id, redirect_uri, code_challenge, code_challenge_method,
    scope, state, nonce: nonce || null,
  });
  return buildLoginPageRedirect(appBaseURL, sid);
}
```

### 6.2 `POST /api/auth/login`

**before:**
```
Request:  { email, password }
Response: JSON { success: true } + Set-Cookie: login_session (path=/api/auth/oauth2/authorize, 5min)
```

**after:**
```
Request:  { email, password, session_id? }
Response: 若 session_id 存在 → 302 /api/auth/oauth2/authorize?session_id={sid}
               + Set-Cookie: login_session (保持现有 5min + Path=/api/auth/oauth2/authorize)
          若 session_id 不存在（兼容旧模式）→ JSON { success: true } + Set-Cookie: login_session
```

**关键变更**：携带 `session_id` 时**不返回 JSON**，而是返回 302 重定向。login 表单需相应改用**原生 `<form>` POST**（浏览器天然跟随 302 + 携带 Set-Cookie），而非 `fetch()`。

> 兼容期过渡：`session_id` 不存在时保持现有 JSON 响应，前端 fetch 路径继续工作。步骤 4（login-form 改造）上线后，fetch 路径逐步退役。

### 6.3 `login-form.tsx`

**before (211 行，含 PKCE 逻辑、URL 构造):**

```typescript
const handleSubmit = async (e) => {
  // ... fetch POST /api/auth/login ...
  const pkceVerifier = generateCodeVerifier();       // ← 浏览器生成
  const pkceChallenge = await generateCodeChallenge(pkceVerifier);
  document.cookie = `pkce_verifier=${pkceVerifier}...`; // ← 非 HttpOnly
  const authUrl = new URL('/api/auth/oauth2/authorize', ...);
  authUrl.searchParams.set('code_challenge', pkceChallenge);
  window.location.href = authUrl.toString();
};
```

**after (~80 行，纯登录表单):**

```typescript
interface LoginFormProps {
  sessionId?: string;          // 唯一从 URL 传入的参数
  initialError?: string | null;
}

// 使用原生 <form method="POST" action="/api/auth/login">
// 浏览器自动跟随 302 + Set-Cookie，无需 fetch + 手动 window.location

export default function LoginForm({ sessionId, initialError }: LoginFormProps) {
  return (
    <form method="POST" action="/api/auth/login">
      {/* session_id 作为隐藏字段，跟随表单提交 */}
      {sessionId && <input type="hidden" name="session_id" value={sessionId} />}
      <input name="email" type="text" required />
      <input name="password" type="password" required />
      <button type="submit">安全登录</button>
    </form>
  );
}
```

> 使用原生 `<form>` POST 的好处：浏览器自动处理 302 重定向链 + Set-Cookie，不需要任何 JS 参与认证流程。

### 6.4 `login/page.tsx`

**before (108 行，解析 10+ 个 OAuth 参数):**

```typescript
const params = await searchParams;
const redirectUrl = params.redirect_url || params.redirect_uri || ...;
const clientId = params.client_id;
const scope = params.scope;
const codeChallenge = params.code_challenge;  // ← 暴露在 URL
// ...传递 10+ props 到 LoginForm...
```

**after (~50 行):**

```typescript
interface SearchParams {
  searchParams: Promise<{
    session_id?: string;
    error?: string;
  }>;
}

async function LoginContent({ searchParams }: SearchParams) {
  const params = await searchParams;
  const sessionId = params.session_id;

  // 检查是否已登录（portal_jwt_token Cookie）
  const cookieStore = await cookies();
  const jwtToken = cookieStore.get(COOKIE_NAMES.JWT)?.value;

  if (jwtToken) {
    const claims = await verifyAccessToken(jwtToken);
    if (claims) {
      if (sessionId) {
        // 已登录 + 授权请求 → 接续 authorize（SSO 免登）
        redirect(`/api/auth/oauth2/authorize?session_id=${sessionId}`);
      }
      redirect('/dashboard');
    }
  }

  return <LoginForm sessionId={sessionId} initialError={params.error || null} />;
}
```

### 6.5 `proxy.ts`

**before:**
```typescript
if (!jwtToken?.value) {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(loginUrl);
}
```

**after:**
```typescript
if (!jwtToken?.value) {
  // Client SSR 层：生成 PKCE + state + nonce
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateId(32);        // 随机值，CSRF 防护
  const nonce = generateId(16);        // OIDC nonce，防 ID Token 重放
  const returnTo = pathname;           // 登录后回跳路径

  const redirectUri = `${getAppBaseURL()}/api/auth/callback`;
  const authUrl = new URL('/api/auth/oauth2/authorize', getAppBaseURL());
  authUrl.searchParams.set('client_id', 'portal');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile email offline_access');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);

  const response = NextResponse.redirect(authUrl);
  const isSecure = getAppBaseURL().startsWith('https://');

  // 四个 HttpOnly Cookie：浏览器完全不可读
  response.cookies.set(COOKIE_NAMES.PKCE_VERIFIER, codeVerifier, {
    path: '/api/auth/callback', httpOnly: true, secure: isSecure,
    sameSite: 'lax', maxAge: 300,
  });
  response.cookies.set(COOKIE_NAMES.OAUTH_STATE, state, {
    path: '/api/auth/callback', httpOnly: true, secure: isSecure,
    sameSite: 'lax', maxAge: 300,
  });
  response.cookies.set(COOKIE_NAMES.OAUTH_NONCE, nonce, {
    path: '/api/auth/callback', httpOnly: true, secure: isSecure,
    sameSite: 'lax', maxAge: 300,
  });
  response.cookies.set(COOKIE_NAMES.RETURN_TO, returnTo, {
    path: '/api/auth/callback', httpOnly: true, secure: isSecure,
    sameSite: 'lax', maxAge: 300,
  });
  return response;
}
```

### 6.6 新增 `src/lib/session/auth-request-store.ts`

```typescript
import 'server-only';
import { getRedis } from '@/infrastructure/redis';
import { REDIS_KEY_PREFIX } from '@auth-sso/contracts';

export interface StoredAuthRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
  nonce?: string;
}

const TTL = 300; // 5min

export async function storeAuthRequest(
  sessionId: string,
  params: StoredAuthRequest,
): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEY_PREFIX.AUTH_REQUEST}${sessionId}`;
  await redis.setex(key, TTL, JSON.stringify(params));
}

export async function getStoredAuthRequest(
  sessionId: string,
): Promise<StoredAuthRequest | null> {
  const redis = getRedis();
  const key = `${REDIS_KEY_PREFIX.AUTH_REQUEST}${sessionId}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuthRequest;
  } catch {
    return null;
  }
}

export async function deleteStoredAuthRequest(sessionId: string): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEY_PREFIX.AUTH_REQUEST}${sessionId}`;
  redis.del(key).catch(() => {});
}

export function generateSessionId(): string {
  return `as_${generateId(32)}`; // 复用到 lib/crypto 的 generateId
}
```

### 6.7 `callback.ts` 变更：state + nonce 校验增强

**before**（当前已读 pkce_verifier 从 Cookie，但 state 校验简化为存在性检查）：

```typescript
if (!state) {
  // 仅检查非空，不做 Cookie 一致性比对
  return NextResponse.redirect(errorUrl);
}
// state 被复用为 "返回路径" → safeRedirectPath(state) 消毒后跳转
```

**after**（state 做 Cookie-Query 一致性校验；nonce 做 ID Token 校验）：

```typescript
export async function GET(request: NextRequest) {
  // ... 获取 code, state from query ...

  // 1. PKCE verifier：从 HttpOnly Cookie 读取（proxy.ts 写入）
  const codeVerifier = request.cookies.get(COOKIE_NAMES.PKCE_VERIFIER)?.value;
  if (!codeVerifier) return errorRedirect('invalid_state');

  // 2. CSRF state：Cookie 与 query 参数一致性校验
  const cookieState = request.cookies.get(COOKIE_NAMES.OAUTH_STATE)?.value;
  if (!cookieState || cookieState !== state) return errorRedirect('csrf_mismatch');

  // 3. nonce：从 HttpOnly Cookie 读取（scope 含 openid 时 proxy.ts 写入）
  const cookieNonce = request.cookies.get(COOKIE_NAMES.OAUTH_NONCE)?.value;

  // 4. 回跳路径：从 HttpOnly Cookie 读取
  const returnTo = request.cookies.get(COOKIE_NAMES.RETURN_TO)?.value;

  // 5. 内部调用 /token（code_verifier 作为独立 body 字段，不编码入 URL）
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: 'portal',
      client_secret: portalClientSecret,
      redirect_uri: redirectUri.toString(),
      code_verifier: codeVerifier,  // ← 独立 body 字段
    }),
  });

  const tokens = await tokenRes.json();

  // 6. nonce 校验：比对 ID Token 中的 nonce claim
  if (cookieNonce && tokens.id_token) {
    const idTokenPayload = decodeJwtPayload(tokens.id_token);
    if (idTokenPayload?.nonce !== cookieNonce) {
      return errorRedirect('nonce_mismatch');
    }
  }

  // 7. 种 portal_jwt_token + portal_refresh_token
  // 8. 清除四个临时 Cookie（pkce_verifier, oauth_state, oauth_nonce, return_to）
  // 9. 302 → safeRedirectPath(returnTo) || '/dashboard'
}
```

### 6.8 文件清单更新（移除 portal_sso 相关，新增 callback 改造）

| 文件 | 变更类型 |
|------|----------|
| `src/lib/session/auth-request-store.ts` | **新增** |
| ~~`src/lib/auth/sso-session.ts`~~ | **不新增**（login_session 保留，portal_jwt_token 覆盖已有会话场景） |

---

## 7. 安全分析

### 7.1 攻击面变化

| 攻击向量 | 当前 | 重构后 |
|----------|------|--------|
| XSS 窃取 PKCE verifier | ✅ 可行（`document.cookie`） | ❌ 不可行（HttpOnly） |
| URL 泄露 code_challenge | ✅ 始终在 /login URL 中 | ❌ /login URL 只含 session_id |
| CSRF 伪造登录请求 | 🟡 SameSite=Lax | ⚠️ 残留风险（见 §7.3） |
| CSRF 伪造授权回调 | 🟡 state 仅做非空检查 | ✅ state Cookie↔Query 一致性校验 |
| ID Token 重放 | ❌ nonce 未生成未校验 | ✅ nonce Cookie↔ID Token 比对 |
| 授权码重放 | 🟡 有 used 标记 | ✅ 不变 + Redis 暂存的 params 用完即删 |
| 第三方 PKCE 被覆盖 | ✅ 冷登录必现 | ❌ login 表单永远不接触 code_challenge |

> 注意：`state` 和 `nonce` Cookie 在 callback 完成后立即清除（`maxAge: 0`），不在浏览器持久化。

### 7.2 session_id 安全

- 32 字符随机 hex（`crypto.randomUUID`），熵值 128 bit
- TTL 5min，与 authorization_code 对齐
- 一次性消费：签发 code 后立即 DEL
- 绑定到 login_session：session_id→params 仅用于恢复参数，签发 code 仍需 login_session Cookie 有效

### 7.3 残留风险：登录型 CSRF / 强制授权

在当前设计（以及现状代码）中，存在以下攻击路径：

1. 攻击者注册恶意 OAuth Client，`redirect_uri` 指向攻击者控制的服务器
2. 攻击者用该 Client 发起 authorize → 获得 `session_id_A`
3. 攻击者诱导受害者访问 `/login?session_id=session_id_A`
4. 受害者输入凭证登录 → login_session 种入受害者浏览器 + 302 到 `/authorize?session_id=session_id_A`
5. AS 恢复 auth params（绑定攻击者的 client）→ 以受害者身份签发 code
6. 浏览器 302 到攻击者的 redirect_uri → 攻击者拿到受害者的授权码

**缓解**：
- `SameSite=Lax` Cookie 阻止跨站 POST 登录请求（但同站导航不受限）
- 此攻击在现状代码中同样存在（`/login?client_id=attacker&redirect_uri=https://evil.com`）
- 彻底修复需要引入 pre-auth Cookie（authorize 时种一个与 session_id 绑定的 Cookie → login 完成时校验该 Cookie 仍存在 → 确认同一浏览器完成整个流程），超出本次重构范围

**结论**：本次重构未引入新攻击面，也未恶化现有残留风险。建议后续独立迭代引入 pre-auth 绑定机制。

---

## 8. 迁移策略

### 8.1 兼容期

两种 URL 格式同时支持：

```
/login?session_id=abc123       ← 新格式（login-form 收到后走原生 form POST）
/login?client_id=xxx&code_challenge=xxx  ← 旧格式（兼容，login-form 走现有 fetch 路径）
```

`POST /api/auth/login` 按 `session_id` 是否存在于 body 分流：
- 有 `session_id` → 302 重定向 + Set-Cookie login_session（新路径）
- 无 `session_id` → JSON `{ success: true }` + Set-Cookie login_session（旧路径）

`GET /api/auth/oauth2/authorize` 按 query 参数分流：
- 有 `session_id` → Redis 恢复参数路径（新路径）
- 无 `session_id`（完整 OAuth params）→ 现有路径（旧路径）

### 8.2 实施步骤（含同批上线标记）

| 步骤 | 内容 | 可否独立上线 |
|------|------|-------------|
| 1 | 新增 Redis 存储 + 合约常量 + `auth-request-store.ts` | ✅ 无破坏性 |
| 2a | `/authorize` 新增 session_id 分支 + Redis 存储/恢复 | ✅ 向后兼容 |
| 2b | `POST /api/auth/login` 新增 session_id→302 分支 | ✅ 向后兼容 |
| 3 | **login-form.tsx + login/page.tsx 简化** | ⚠️ **必须与步骤 2 同批上线** |
| 4 | proxy.ts 改造（Client SSR 层） | ✅ 独立 |
| 5 | callback.ts state/nonce 校验增强 | ✅ 独立 |

> 步骤 3 是关键窗口：新 login-form 提交原生 form POST + session_id，依赖步骤 2b 的 302 响应。若步骤 3 先于 2b 上线，login-form 期望 302 但收到 JSON → 白屏。**步骤 2b 和步骤 3 必须同批部署**。

### 8.3 回滚方案

- `login_session` Cookie 不删除
- Redis `portal:auth_req:` 是新增 key，不影响现有配置
- proxy.ts 改造仅限于无 JWT 分支，有 JWT 路径不变

---

## 9. 影响范围

| 受影响方 | 变更 |
|----------|------|
| 第三方 OAuth Client | **零变更**——登录页 URL 从 `/login?client_id=...&code_challenge=...` 变为 `/login?session_id=xxx`，但 Client 自身不感知（它只跳转 /authorize） |
| Portal Admin UI 用户 | 登录流程不变，URL 栏短暂显示 `/authorize?session_id=xxx` 后显示登录页 |
| Gateway | **零变更**——`portal_jwt_token` 验签逻辑不变 |
| RS（第三方后端） | **零变更**——Access Token 格式不变 |

---

## 10. 测试要点

1. **Portal 自登录**：User→/dashboard→无 JWT→proxy.ts 生成 PKCE+state+nonce→4 个 HttpOnly Cookie→/authorize→/login?session_id→登录→/authorize?session_id→callback 校验 state+nonce→/dashboard
2. **第三方 SSO 冷登录**：Third-party SSR 生成 PKCE+state→/authorize→/login?session_id→登录→/authorize?session_id→third-party callback→PKCE 通过
3. **第三方 SSO 热登录（免登）**：User 已有 portal_jwt_token→third-party SSR→/authorize→Cookie 路径读 portal_jwt_token→直接签发 code→callback→PKCE 通过
4. **session_id 过期**：5min 后 Redis key 消失 → /authorize?session_id=xxx 返回 session_expired 错误页
5. **session_id 重放**：第一次签发 code 后 session_id 被删除，重放返回 session_expired
6. **state CSRF 防护**：callback 中 Cookie state ≠ URL query state → 403
7. **nonce 校验**：callback 中 Cookie nonce ≠ ID Token nonce → 403
8. **code_challenge 隔离**：/login 页面 URL 只有 session_id，无法读取 code_challenge → 第三方 PKCE 永久不会覆盖
9. **旧模式兼容**：无 session_id 的 login POST → JSON 响应（兼容期）
