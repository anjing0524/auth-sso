# 子应用 SSO 接入规范

## 概述

本文档说明如何将子应用接入 Auth-SSO 系统，实现单点登录（SSO）功能。

## 接入前提

- 子应用能够发起 HTTP 请求（服务端或客户端）
- 支持设置和读取 Cookie
- 能够存储临时状态（用于 OAuth state、nonce、code_verifier）

## OAuth 2.1 配置

### IdP 端点

| 端点 | 地址 | 说明 |
|------|------|------|
| Authorization | `/api/auth/authorize` | 授权端点 |
| Token | `/api/auth/token` | Token 端点 |
| UserInfo | `/api/auth/userinfo` | 用户信息端点 |
| JWKS | `/api/auth/jwks` | JWKS 端点 |
| EndSession | `/api/auth/sign-out` | 登出端点 |
| Discovery | `/.well-known/openid-configuration` | OIDC Discovery |

### 支持的 Scopes

| Scope | 说明 |
|-------|------|
| `openid` | 必须，启用 OIDC |
| `profile` | 用户基本信息 |
| `email` | 用户邮箱 |
| `offline_access` | 获取 refresh_token |

## 接入流程

### 步骤 1：注册 Client

联系管理员在 IdP 中注册您的应用：

```typescript
// 需要提供的信息
{
  clientId: string;           // 唯一标识
  clientSecret: string;       // 客户端密钥
  name: string;               // 应用名称
  redirectUrls: string[];     // 回调地址列表
  skipConsent?: boolean;      // 是否跳过授权确认页
}
```

### 步骤 2：实现授权入口

```typescript
// GET /api/auth/login
import { generateRandomString, generateCodeVerifier, generateCodeChallenge } from './oauth';

// 1. 生成随机参数
const state = generateRandomString(32);
const nonce = generateRandomString(32);
const codeVerifier = generateCodeVerifier(); // 43-128 字符
const codeChallenge = await generateCodeChallenge(codeVerifier);

// 2. 保存状态（Cookie 或 Session）
saveOAuthState({ state, nonce, codeVerifier });

// 3. 构建授权 URL
const authUrl = new URL('http://localhost:4001/api/auth/authorize');
authUrl.searchParams.set('client_id', 'your-client-id');
authUrl.searchParams.set('redirect_uri', 'http://localhost:YOUR_PORT/auth/callback');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'openid profile email');
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('nonce', nonce);
authUrl.searchParams.set('code_challenge', codeChallenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

// 4. 重定向
return Response.redirect(authUrl);
```

### 步骤 3：处理回调

```typescript
// GET /api/auth/callback
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // 1. 验证 state
  const savedState = getOAuthState();
  if (state !== savedState.state) {
    throw new Error('State mismatch');
  }

  // 2. 用授权码换取 Token
  const tokenResponse = await fetch('http://localhost:4001/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:YOUR_PORT/auth/callback',
      client_id: 'your-client-id',
      client_secret: 'your-client-secret',
      code_verifier: savedState.codeVerifier,
    }),
  });

  const tokens = await tokenResponse.json();

  // 3. 验证 id_token nonce (如果包含 id_token)
  if (tokens.id_token) {
    const { decodeJwt } = await import('jose'); // 使用 jose 或类似库
    const decoded = decodeJwt(tokens.id_token);
    if (decoded.nonce !== savedState.nonce) {
      throw new Error('Nonce mismatch');
    }
  }

  // 4. 获取用户信息
  const userResponse = await fetch('http://localhost:4001/api/auth/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userResponse.json();

  // 4. 创建本地 Session
  createSession(user, tokens);

  // 5. 重定向到应用主页
  return Response.redirect(new URL('/', request.url));
}
```

### 步骤 4：实现登出

```typescript
// GET /api/auth/logout
export async function GET() {
  // 1. 清除本地 Session
  clearSession();

  // 2. 重定向到 IdP 登出端点
  const logoutUrl = new URL('http://localhost:4001/api/auth/sign-out');
  logoutUrl.searchParams.set('post_logout_redirect_uri', 'http://localhost:YOUR_PORT');
  return Response.redirect(logoutUrl);
}
```

## PKCE 实现

PKCE 是必需的安全机制：

```typescript
// 生成 code_verifier (43-128 字符)
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

// 生成 code_challenge
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

// Base64 URL 编码
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

## SSO 工作原理

### 单点登录

1. 用户首次访问 App A
2. App A 重定向到 IdP 授权端点
3. 用户在 IdP 登录
4. IdP 创建 Session，重定向回 App A
5. App A 获取 Token 和用户信息

当用户访问 App B 时：
1. App B 重定向到 IdP 授权端点
2. IdP 检测到已有有效 Session
3. IdP 直接返回授权码，无需重新登录
4. App B 获取 Token 和用户信息

### 单点登出

1. 用户在任一应用发起登出
2. 应用清除本地 Session
3. 重定向到 IdP 登出端点
4. IdP 清除 IdP Session
5. 所有应用都需重新登录

## 安全要求

1. **必须使用 PKCE** - 防止授权码拦截攻击
2. **必须验证 state** - 防止 CSRF 攻击
3. **必须验证 nonce** - 防止重放攻击。IdP 会在 id_token 中包含 nonce，回调处理时必须严格校验其值与发起登录时生成的值一致。Auth-SSO Portal 已实现强制 Nonce 校验。
4. **Token 不应暴露给客户端** - access_token 应存储在 HttpOnly Cookie 或服务端 Session
5. **HTTPS** - 生产环境必须使用 HTTPS
6. **回调地址白名单** - 只能注册预先定义的回调地址

## 错误处理

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `invalid_request` | 请求参数错误 | 检查请求参数 |
| `unauthorized_client` | 客户端未授权 | 检查 client_id |
| `access_denied` | 用户拒绝授权 | 引导用户重新授权 |
| `unsupported_response_type` | 不支持的响应类型 | 使用 `code` |
| `invalid_scope` | 无效的 scope | 检查请求的 scope |
| `server_error` | 服务器错误 | 联系管理员 |

## 测试清单

- [ ] 未登录时能正确跳转到 IdP 登录页
- [ ] 登录成功后能正确获取用户信息
- [ ] 已登录 IdP 时能自动完成 SSO 认证
- [ ] 登出后无法继续访问受保护资源
- [ ] Portal 登出后子应用需重新登录
- [ ] 错误的 state/nonce 能被正确拒绝
- [ ] 无效的回调地址能被正确拒绝

## 示例代码

完整示例请参考 `apps/demo-app` 目录。