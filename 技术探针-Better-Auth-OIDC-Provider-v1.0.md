# 技术探针报告：Better Auth OAuth Provider 能力验证

- 日期：2026-03-24
- 目标：验证 Better Auth 是否满足 Auth-SSO v1.0 的 OIDC 需求
- 状态：**已验证通过**

---

## 1. 需求清单

根据技术选型文档 (`技术选型-auth-sso-v1.0.md`)，v1.0 需要以下能力：

| 需求 | 说明 |
|------|------|
| 授权码模式 | OAuth 2.1 Authorization Code Flow |
| PKCE | 防止授权码拦截攻击 |
| openid scope | OIDC 身份认证 |
| /authorize 端点 | 授权端点 |
| /token 端点 | Token 端点 |
| /userinfo 端点 | 用户信息端点 |
| /jwks 端点 | JWT 公钥端点 |
| Access Token / Refresh Token | Token 签发与刷新 |
| Session 管理 | Redis 存储 |
| Client 配置管理 | Client 注册与管理 |

---

## 2. 验证结果

### 2.1 OAuth 2.1 Provider 插件能力 ✅

Better Auth 提供 `oauth-provider` 插件，支持完整的 OAuth 2.1 规范：

| 端点 | 路径 | 状态 |
|------|------|------|
| Authorization | `GET /oauth2/authorize` | ✅ 支持 |
| Token | `POST /oauth2/token` | ✅ 支持 |
| UserInfo | `GET /oauth2/userinfo` | ✅ 支持 |
| Introspect | `POST /oauth2/introspect` | ✅ 支持 |
| Register | `POST /oauth2/register` | ✅ 支持 (动态注册) |

### 2.2 PKCE 支持 ✅

```typescript
// 授权请求参数
{
  code_challenge: string,        // 必需
  code_challenge_method: "S256"  // 必需，只支持 S256
}
```

- OAuth 2.1 规范默认要求 PKCE
- 只支持 `S256` 方法（`plain` 不支持）
- 可为特定 Client 禁用 PKCE（`require_pkce: false`）

### 2.3 OIDC Provider 插件能力 ✅

Better Auth 提供 `oidc-provider` 插件，扩展自 `oauth-provider`：

```typescript
import { betterAuth } from "better-auth";
import { oidcProvider } from "better-auth/plugins";
import { jwt } from "better-auth/plugins";

export const auth = betterAuth({
    disabledPaths: ["/token"],  // 禁用默认 token 端点
    plugins: [
        jwt(),  // JWT 插件提供 JWKS 能力
        oidcProvider({
            useJWTPlugin: true,  // 集成 JWT 插件
            loginPage: "/sign-in",
            consentPage: "/consent",
            scopes: ["openid", "profile", "email", "offline_access"]
        })
    ]
});
```

**支持的 OIDC scopes：**

| Scope | 返回内容 |
|-------|----------|
| `openid` | 用户 ID (`sub` claim) |
| `profile` | name, picture, given_name, family_name |
| `email` | email, email_verified |
| `offline_access` | Refresh Token |

### 2.4 JWKS 端点 ✅

通过集成 `jwt` 插件实现：

- ID Token 使用非对称密钥签名
- JWKS 端点提供公钥验证
- 符合 OIDC 规范

### 2.5 Session 与 Redis 存储 ✅

Better Auth 支持通过 `secondaryStorage` 配置 Redis：

```typescript
import { betterAuth } from "better-auth";
import { Redis } from "ioredis";
import { redisStorage } from "@better-auth/redis-storage";

const redis = new Redis({
    host: "localhost",
    port: 6379,
});

export const auth = betterAuth({
    secondaryStorage: redisStorage({
        client: redis,
        keyPrefix: "idp:",
    }),
    // ...
});
```

**官方包：** `@better-auth/redis-storage`

### 2.6 Client 管理 ✅

**数据库表结构：**

```typescript
interface OAuthClient {
  id: string;                    // 数据库 ID
  clientId: string;              // 唯一标识符
  clientSecret?: string;         // 密钥（公开客户端可选）
  name?: string;                 // 应用名称
  redirectUris: string[];        // 回调地址
  scopes?: string[];             // 允许的 scopes
  grantTypes?: string[];         // 授权类型
  public?: boolean;              // 是否公开客户端
  tokenEndpointAuthMethod?: string;  // 认证方式
  disabled?: boolean;            // 是否禁用
  userId?: string;               // 所属用户
  createdAt: Date;
  updatedAt: Date;
}
```

**API 创建 Client：**

```typescript
await auth.api.createOAuthClient({
  body: {
    client_name: 'Portal',
    redirect_uris: ['https://portal.example.com/callback'],
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'],
    scopes: ['openid', 'profile', 'email']
  }
});
```

### 2.7 Token 表结构 ✅

```typescript
// Access Token
interface OAuthAccessToken {
  id: string;
  token: string;         // 哈希后的 token
  clientId: string;
  userId?: string;
  scopes: string[];
  expiresAt: Date;
  refreshId?: string;    // 关联的 refresh token
}

// Refresh Token
interface OAuthRefreshToken {
  id: string;
  token: string;
  clientId: string;
  userId: string;
  scopes: string[];
  expiresAt: Date;
  revoked?: Date;
}
```

---

## 3. 与架构设计的兼容性

### 3.1 数据归属 ✅

| 数据 | 架构设计要求 | Better Auth 实现 |
|------|-------------|-----------------|
| Client 配置 | `portal_core.clients` | `idp_auth.oauthClient` |
| Access Token | `idp_auth` | `idp_auth.oauthAccessToken` |
| Refresh Token | `idp_auth` | `idp_auth.oauthRefreshToken` |
| Session | `Redis idp:*` | `secondaryStorage` (Redis) |

**注意：** 根据架构设计，Client 配置应由 `portal_core` 管理，IdP 只读消费。需要：
1. Portal 管理界面创建 Client 时同步写入 `portal_core.clients` 和 `idp_auth.oauthClient`
2. 或者 Better Auth 直接使用 `portal_core` 的 Client 表（需要自定义 adapter）

### 3.2 用户身份映射 ✅

Better Auth 核心表：
- `user` — 认证用户
- `session` — 会话
- `account` — 关联账户
- `verification` — 验证记录

架构设计中的 `user_identities` 表用于映射业务用户与 IdP 主体，可以：
1. Better Auth `user.id` 作为 `subject`
2. Portal 用户创建时同步创建 Better Auth 用户
3. 通过 `getAdditionalUserInfoClaim` 返回业务用户信息

---

## 4. 需要确认的问题

### 4.1 Client 配置来源

**问题：** 架构设计要求 Client 配置由 `portal_core.clients` 管理，但 Better Auth 期望从 `idp_auth.oauthClient` 读取。

**解决方案：**
1. **方案 A（推荐）：** Portal 创建 Client 时同步写入两表
2. **方案 B：** 自定义 Better Auth storage adapter 读取 `portal_core`
3. **方案 C：** 接受 Better Auth 管理 Client，Portal 只做展示

**建议采用方案 A：** 简单直接，保持架构设计意图。

### 4.2 用户同步

**问题：** Portal 用户与 Better Auth 用户如何关联？

**解决方案：**
1. Portal 创建用户时调用 Better Auth API 创建对应主体
2. `user_identities.subject` 存储Better Auth `user.id`
3. 登录时通过 subject 反查业务用户

---

## 5. 结论

### 验证结果：**通过**

Better Auth OAuth Provider / OIDC Provider 插件 **满足** Auth-SSO v1.0 的核心需求：

| 需求 | 状态 | 备注 |
|------|------|------|
| 授权码模式 | ✅ | OAuth 2.1 规范 |
| PKCE | ✅ | S256 方法 |
| openid scope | ✅ | 通过 oidc-provider 插件 |
| 标准端点 | ✅ | /authorize, /token, /userinfo, /jwks |
| Token 管理 | ✅ | Access Token / Refresh Token |
| Session 存储 | ✅ | Redis secondaryStorage |
| Client 管理 | ⚠️ | 需要同步到 portal_core |

### 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| Client 配置双写一致性 | 中 | 使用事务或事件驱动同步 |
| 用户身份映射复杂度 | 低 | 建立明确的映射表 |
| Better Auth 版本更新 | 低 | 锁定版本，谨慎升级 |

### 下一步

1. 创建 M1 基础底座，初始化项目结构
2. 集成 Better Auth，配置 OIDC Provider
3. 实现 Portal Client 管理与 IdP 同步逻辑
4. 实现用户身份映射

---

## 6. 参考资料

- [Better Auth OAuth Provider 文档](https://github.com/better-auth/better-auth/blob/canary/docs/content/docs/plugins/oauth-provider.mdx)
- [Better Auth OIDC Provider 文档](https://github.com/better-auth/better-auth/blob/canary/docs/content/docs/plugins/oidc-provider.mdx)
- [Better Auth JWT 插件](https://github.com/better-auth/better-auth/blob/canary/docs/content/docs/plugins/jwt.mdx)
- [Better Auth Redis Storage](https://github.com/better-auth/better-auth/blob/canary/docs/content/docs/concepts/database.mdx)