# 安全检查清单

## 1. OAuth 安全

### 1.1 State 参数 ✅
- [x] 生成随机 state（32字符）
- [x] 存储 state 到 HttpOnly Cookie
- [x] 回调时验证 state 匹配
- [x] State 过期检查（10分钟）

### 1.2 PKCE ✅
- [x] 生成 code_verifier（64字符）
- [x] 使用 S256 方法生成 code_challenge
- [x] Token 交换时发送 code_verifier

### 1.3 Nonce ⚠️
- [x] 生成随机 nonce
- [ ] **待完善**: 验证 id_token 中的 nonce 声明

### 1.4 回调地址白名单 ✅
- [x] IdP 的 trustedClients 配置中定义 redirectUrls
- [x] 只接受预定义的回调地址

## 2. Token 安全

### 2.1 Token 存储 ✅
- [x] access_token 存储在 Redis Session（不暴露给浏览器）
- [x] refresh_token 存储在 Redis Session
- [x] Session Cookie 为 HttpOnly

### 2.2 Token 传输 ✅
- [x] Token 不出现在 URL 中
- [x] Token 不存储在 localStorage/sessionStorage

### 2.3 Token 撤销 ✅
- [x] 登出时调用 IdP 撤销端点
- [x] 撤销 refresh_token

## 3. Session 安全

### 3.1 Cookie 属性 ✅
- [x] HttpOnly: true
- [x] SameSite: lax
- [x] Secure: 生产环境启用
- [x] Path: /

### 3.2 Session 过期 ✅
- [x] Idle timeout（30分钟）
- [x] Absolute timeout（7天）
- [x] 每次请求更新 lastAccessAt

### 3.3 Session 存储 ✅
- [x] Session 存储在 Redis
- [x] Session ID 随机生成（32字符）

## 4. 登出安全

### 4.1 单点登出 ✅
- [x] 清除 Portal Session（Redis）
- [x] 清除 Portal Session Cookie
- [x] 调用 IdP 登出端点
- [x] 撤销 Token

## 5. 输入验证

### 5.1 SQL 注入防护 ✅
- [x] 使用参数化查询（postgres.js）
- [x] 字符串转义处理

### 5.2 XSS 防护 ✅
- [x] React 自动转义
- [x] HttpOnly Cookie

### 5.3 CSRF 防护 ✅
- [x] SameSite Cookie
- [x] State 参数验证

## 6. 权限校验

### 6.1 API 权限 ✅
- [x] 所有管理 API 都有权限检查
- [x] 使用 withPermission 中间件

### 6.2 菜单权限 ✅
- [x] 前端根据权限过滤菜单
- [x] 无权限不显示菜单项

## 7. 审计日志

### 7.1 登录日志 ✅
- [x] 登录成功日志
- [x] 登录失败日志
- [x] 登出日志

### 7.2 操作日志 ✅
- [x] 用户变更日志
- [x] 角色变更日志
- [x] 权限变更日志
- [x] Client 变更日志

## 待改进项

### 1. Nonce 验证（中优先级）
需要在 OAuth 回调中验证 id_token 的 nonce 声明，防止重放攻击。

**改进方案：**
```typescript
// 在 callback/route.ts 中添加
import { jwtVerify, createRemoteJWKSet } from 'jose';

async function verifyIdToken(idToken: string, expectedNonce: string) {
  const jwks = createRemoteJWKSet(new URL('/api/auth/jwks', oauthConfig.idpUrl));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: oauthConfig.idpUrl,
    audience: oauthConfig.clientId,
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error('Nonce mismatch');
  }

  return payload;
}
```

### 2. IP 记录（低优先级）
在审计日志中记录用户 IP 地址。

### 3. 速率限制（中优先级）
为登录 API 添加速率限制，防止暴力破解。

## 安全配置建议

### 环境变量
```env
# 生产环境必须设置
BETTER_AUTH_SECRET=your-secret-min-32-chars
BETTER_AUTH_URL=https://your-domain.com
NODE_ENV=production

# Session 配置
SESSION_IDLE_TIMEOUT_MS=1800000    # 30分钟
SESSION_ABSOLUTE_TIMEOUT_MS=604800000  # 7天
```

### HTTPS
生产环境必须启用 HTTPS，确保：
- Cookie Secure 属性生效
- Token 传输加密
- 防止中间人攻击