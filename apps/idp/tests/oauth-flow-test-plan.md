# OAuth 2.1 Authorization Code Flow with PKCE - 测试计划

## 测试范围

### 1. IdP 端点测试

#### 1.1 健康检查端点
- **端点**: `GET /api/auth/ok`
- **预期**: 返回 `{"ok":true}`
- **状态**: ✅ 通过

#### 1.2 登录端点
- **端点**: `POST /api/auth/sign-in/email`
- **请求体**: `{ "email": "admin@example.com", "password": "test123456" }`
- **预期**:
  - HTTP 200
  - 返回 `{ "redirect": false, "token": "...", "user": {...} }`
  - 设置 session cookie
- **状态**: ✅ 通过

#### 1.3 授权端点
- **端点**: `GET /api/auth/oauth2/authorize`
- **参数**:
  - `response_type=code`
  - `client_id=portal`
  - `redirect_uri=http://localhost:4000/api/auth/callback`
  - `scope=openid profile email`
  - `state=<random>`
  - `code_challenge=<PKCE challenge>`
  - `code_challenge_method=S256`
- **预期**:
  - 已登录用户: HTTP 302 重定向到 `redirect_uri?code=<code>&state=<state>`
  - 未登录用户: HTTP 302 重定向到 `/sign-in?<params>`
- **状态**: ✅ 通过

#### 1.4 Token 交换端点
- **端点**: `POST /api/auth/oauth2/token`
- **请求体**:
  - `grant_type=authorization_code`
  - `code=<authorization_code>`
  - `client_id=portal`
  - `client_secret=portal-secret`
  - `redirect_uri=http://localhost:4000/api/auth/callback`
  - `code_verifier=<PKCE verifier>`
- **预期**:
  - HTTP 200
  - 返回 `{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600, "id_token": "...", "refresh_token": "..." }`
- **状态**: ✅ 通过

#### 1.5 用户信息端点
- **端点**: `GET /api/auth/oauth2/userinfo`
- **Header**: `Authorization: Bearer <access_token>`
- **预期**: 返回用户 claims
- **状态**: ✅ 通过

#### 1.6 JWKS 端点
- **端点**: `GET /api/auth/jwks`
- **预期**: 返回 JWT 签名公钥
- **状态**: ✅ 通过

#### 1.7 OIDC Discovery 端点
- **端点**: `GET /api/auth/.well-known/openid-configuration`
- **预期**: 返回 OIDC 配置信息
- **状态**: ✅ 通过

---

### 2. Portal OAuth 客户端测试

#### 2.1 登录入口
- **端点**: `GET /api/auth/login`
- **预期**:
  - 生成 PKCE code_verifier 和 code_challenge
  - 生成 state 和 nonce
  - HTTP 302/307 重定向到 IdP authorize 端点
- **状态**: ✅ 通过

#### 2.2 OAuth 回调端点
- **端点**: `GET /api/auth/callback?code=<code>&state=<state>`
- **预期**:
  - 验证 state 参数
  - 用 code 换取 token
  - 创建 Portal session
  - 重定向到首页
- **状态**: ⏳ 待测试 (需要完整浏览器流程)

#### 2.3 用户信息获取
- **端点**: Portal 内部获取用户信息
- **预期**: 显示已登录用户信息
- **状态**: ⏳ 待测试 (需要完整浏览器流程)

---

### 3. 完整流程测试

#### 3.1 正常登录流程
1. 用户访问 Portal `/login`
2. 重定向到 IdP `/sign-in`
3. 用户输入账号密码
4. 登录成功，重定向到 IdP authorize
5. Authorize 返回 code
6. Portal 用 code 换取 token
7. Portal 显示已登录状态

#### 3.2 PKCE 验证
- 验证 code_verifier 与 code_challenge 匹配
- Token 端点应拒绝不匹配的请求

#### 3.3 State 验证
- Portal 验证回调的 state 与发起时一致
- 防止 CSRF 攻击

---

## 测试账号

| 字段 | 值 |
|------|-----|
| Email | `admin@example.com` |
| Password | `test123456` |

## OAuth Client 配置

| 字段 | 值 |
|------|-----|
| Client ID | `portal` |
| Client Secret | `portal-secret` |
| Redirect URI | `http://localhost:4000/api/auth/callback` |
| Scopes | `openid profile email offline_access` |

---

## 服务地址

| 服务 | URL |
|------|-----|
| IdP | http://localhost:4001 |
| Portal | http://localhost:4000 |

---

## 测试结果汇总

**日期**: 2026-03-30

### IdP 端点测试 (8/8 通过)
| 测试项 | 状态 |
|--------|------|
| 健康检查端点 | ✅ |
| 登录端点 | ✅ |
| 授权端点 | ✅ |
| Token 交换端点 | ✅ |
| 用户信息端点 | ✅ |
| JWKS 端点 | ✅ |
| OIDC Discovery 端点 | ✅ |
| Portal 登录入口 | ✅ |