# Demo App - SSO 测试应用

这是一个演示子应用，用于验证 SSO 接入功能。

## 功能特性

- ✅ 标准 OAuth 2.1 Authorization Code Flow with PKCE
- ✅ OpenID Connect 支持
- ✅ SSO 单点登录（基于 IdP Session）
- ✅ 单点登出

## 启动方式

```bash
# 在项目根目录执行
cd apps/demo-app

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

应用将在 http://localhost:4002 启动。

## 配置说明

### OAuth 配置

在 `src/lib/oauth.ts` 中配置：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `issuer` | http://localhost:4001 | IdP 地址 |
| `clientId` | demo-app | OAuth Client ID |
| `clientSecret` | demo-app-secret | OAuth Client Secret |
| `redirectUri` | http://localhost:4002/auth/callback | 回调地址 |

### 环境变量

也可以通过环境变量配置：

```env
OAUTH_ISSUER=http://localhost:4001
OAUTH_CLIENT_ID=demo-app
OAUTH_CLIENT_SECRET=demo-app-secret
OAUTH_REDIRECT_URI=http://localhost:4002/auth/callback
APP_URL=http://localhost:4002
```

## SSO 验证流程

### 场景 1：用户已登录 Portal

1. 访问 http://localhost:4002
2. 点击 "SSO 登录"
3. 由于 IdP Session 有效，自动完成认证
4. 跳回 Demo App 并显示用户信息

### 场景 2：用户未登录

1. 访问 http://localhost:4002
2. 点击 "SSO 登录"
3. 跳转到 IdP 登录页
4. 完成登录后自动跳回 Demo App

### 场景 3：单点登出

1. 在 Demo App 点击 "登出"
2. 清除本地 Session
3. 重定向到 IdP 登出端点
4. 如果配置了 `post_logout_redirect_uri`，会跳回应用首页

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | GET | 发起 OAuth 授权请求 |
| `/api/auth/callback` | GET | OAuth 回调处理 |
| `/api/auth/logout` | GET/POST | 登出 |
| `/api/me` | GET | 获取当前用户信息 |

## 接入指南

### 1. 注册 Client

在 IdP 中注册新的 OAuth Client：

```typescript
// apps/idp/src/lib/auth.ts
trustedClients: [
  {
    clientId: 'your-app',
    clientSecret: 'your-secret',
    name: 'Your App',
    type: 'web',
    redirectUrls: ['http://localhost:YOUR_PORT/auth/callback'],
    metadata: {},
    disabled: false,
    skipConsent: true, // 可选，跳过授权确认页
  },
]
```

### 2. 实现授权流程

```typescript
// 1. 生成 state、nonce、code_verifier
// 2. 构建授权 URL 并重定向
// 3. 在回调中用 code 换取 token
// 4. 获取用户信息
```

### 3. PKCE 要求

所有 Client 都必须实现 PKCE：

```typescript
// 生成 code_verifier (43-128 字符)
const codeVerifier = generateRandomString(64);

// 生成 code_challenge (S256 方法)
const codeChallenge = await sha256(codeVerifier);
```

## 注意事项

- 确保 IdP 运行在 http://localhost:4001
- 确保 Portal 运行在 http://localhost:4000
- Demo App 运行在 http://localhost:4002
- 所有应用共享同一 IdP Session（SSO 关键）