# Auth-SSO 系统设计迭代（v1.2 — 深度扩展）

> 日期: 2026-07-24
> 基于: v1.1（ADR-001~009 全量实现）的代码实证审计
> 范围: 功能模块 / 业务逻辑 / 数据架构 / 异常处理 / 安全

---

## 总览：当前架构遗留的 12 个系统性缺陷

| # | 缺陷 | 维度 | 严重度 | 根因 |
|---|------|------|--------|------|
| 1 | Refresh Token `token_hash` 列存的是明文，非 SHA-256 | 数据架构 | **高危** | v2 重构残留，列名误导 |
| 2 | `rotateRefreshToken` 与 `revokeAllRefreshTokens` 调用方各自编码错误处理 | 异常处理 | 中 | 无统一错误契约 |
| 3 | DB fallback 的暴力破解计数使用 `GREATEST(ts, lastLoginAt)` — 成功后不清除旧日志 | 业务逻辑 | 低 | 设计时未考虑重置语义 |
| 4 | `check-permission.ts` 三路径（Redis→Parse→DB）降级，Redis 不可用时每次慢查询 | 架构 | 中 | 缺少熔断/本地缓存 |
| 5 | Gateway 和 Portal 各维护一套 rate limiter，策略不一致 | 安全 | **高** | 无统一限流平面 |
| 6 | 审计日志 `fire-and-forget` + 3 次重试 — 应用重启时丢失未写入日志 | 异常处理 | 中 | 无持久化缓冲 |
| 7 | JWKS 私钥 `AES-256-GCM` 加密为可选项，生产环境可能遗漏 | 安全 | **高** | 无强制哨兵检查 |
| 8 | `login/route.ts` 使用 `new Date()` 控制 lastLoginAt + Cookie，无时钟一致性保证 | 业务逻辑 | 低 | 单实例无问题，分布式需 NTP |
| 9 | No `X-Content-Type-Options: nosniff` / `X-Frame-Options` 安全头注入 | 安全 | 中 | 缺失响应头加固 |
| 10 | `getUserPermissionContext` 4 层嵌套 Drizzle 查询 — COALESCE/N+1 未优化 | 数据架构 | 中 | 无查询计划审查 |
| 11 | 无 WebAuthn / TOTP 多因子认证路径 | 功能模块 | 中 | 仅密码认证 |
| 12 | OAuth 无 DPoP (RFC 9449) 绑定 — AT 泄露后任意客户端可滥用 | 安全 | **高** | 无 Token 绑定 |

---

## 一、功能模块扩展

### 1.1 多因子认证（MFA）接入

动机: 当前 `login/route.ts` 仅有密码认证单一路径 (§4.1.3)。NFR-SEC-06 防御暴力破解但不断言用户身份强认证。

**设计**:

```
POST /api/auth/login → { email, password } → 校验通过
  → 用户未启用 MFA: 签发 login_session → 完成
  → 用户已启用 MFA: 返回 { mfa_required: true, mfa_session: "<token>" }
    → 浏览器跳转 MFA 验证页
    → POST /api/auth/mfa/verify → { mfa_session, code }
      → 验证通过: 签发 login_session → 完成
      → 验证失败: 递增 MFA 失败计数 → N 次后锁定
```

**Schema 变更**:

```sql
-- users 表追加
ALTER TABLE users ADD COLUMN mfa_method varchar(10) DEFAULT NULL;  -- 'totp' | 'webauthn' | NULL
ALTER TABLE users ADD COLUMN mfa_secret text DEFAULT NULL;          -- TOTP 密钥 (AES-256-GCM 加密)
ALTER TABLE users ADD COLUMN mfa_failed_attempts smallint DEFAULT 0;

-- 新增表
CREATE TABLE mfa_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  device_name varchar(100),
  transports text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
```

### 1.2 账户恢复流程

动机: 无密码重置/账户恢复路径。`resetPasswordAction` 需要管理员操作，不支持用户自助。

**设计**:

```
POST /api/auth/forgot-password → { email }
  → 生成 token (SHA-256 hash, TTL 15min) → 存入 Redis
  → 发送邮件（若邮件服务未配置，返回 masked 提示）
  → 返回 { sent: true } (防止用户枚举)
  
POST /api/auth/reset-password → { token, new_password }
  → 校验 token (Redis EXISTS → DEL)
  → 校验密码复杂度
  → hashPassword → UPDATE users SET password_hash = ...
  → revokeAllRefreshTokens(userId)  -- 旧会话全失效
  → 返回 { success: true }
```

### 1.3 会话管理 UI（管理员视角）

动机: 无"查看所有活跃会话/强制下线"功能。仅 `revokeUserAccessByUserId` 存在。

```
GET /api/users/:id/sessions → 读取 Redis portal:user_jti:{id} Hash
  → 返回 [{ jti, exp, age }]

DELETE /api/users/:id/sessions/:jti → revokeJti(jti, exp)
DELETE /api/users/:id/sessions → revokeUserAccessByUserId(id)
```

### 1.4 全局 CORS 配置

动机: OAuth Token/UserInfo/Introspection/Revocation 端点可能被第三方 JS 调用。

```typescript
// lib/cors.ts
const CORS_ALLOWED_ORIGINS = getTrustedOrigins();

export function corsHeaders(origin: string | null): HeadersInit {
  if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    };
  }
  return {};
}
```

---

## 二、业务逻辑修复与增强

### 2.1 `token_hash` 列语义修复（高危）

**现状**:
```
issueRefreshToken: tokenHash: hashToken(token)   // 实际存的是 hash
logout:           WHERE tokenHash = hashToken(rt) // 正确
rotateRefreshToken: WHERE tokenHash = hashToken(rt) // 正确
```

但旧版代码曾存明文字段。Drizzle migration 后 `refresh_tokens` 已有部分行明文存储。

**修复**:

```typescript
// migration: 对 token_hash 仍为明文的行执行原地哈希
UPDATE refresh_tokens
SET token_hash = encode(sha256(token_hash::bytea), 'hex')
WHERE token_hash NOT SIMILAR TO '[a-f0-9]{64}';
```

同时 DATABASE.md 已修正注释（明文化存储）。

### 2.2 暴力破解 DB fallback 路径修复

**现状**: `checkBruteForce` 的 DB 回退使用 `GREATEST(lockWindowStart, lastLoginAt)` 排除登录成功前的旧失败日志。但登录成功后 `clearBruteForceCounter` 只清 Redis，不清 DB。下次 Redis 故障时，DB 回退仍会扫描到 Redis 存活期间的旧失败日志。

**修复**:

```typescript
// login/route.ts 登录成功后追加
await db.update(schema.users).set({
  lastLoginAt: new Date(),
  // 在用户表存储最后一次失败时间，DB 回退时作为过滤基准
  lastFailedLoginAt: null,
}).where(eq(schema.users.id, user.id));
```

`lastFailedLoginAt` 列由 `incrementBruteForce` 的 DB 路径写入，登录成功清零。

### 2.3 checkPermission 降级熔断

**现状**: `check-permission.ts` 每次请求都尝试 Redis → JSON.parse → DB 三路径，Redis 不可用时每次请求都查 DB。

**修复**: 引入熔断器模式

```typescript
import { CircuitBreaker } from '@/lib/circuit-breaker';

const permCacheBreaker = new CircuitBreaker({
  failureThreshold: 3,      // 连续 3 次 Redis 失败
  successThreshold: 2,       // 连续 2 次成功恢复
  cooldownMs: 30_000,        // 30s 冷却
});

async function getCachedPermissions(userId: string): Promise<UserPermissionContext | null> {
  if (!permCacheBreaker.isOpen()) {
    try {
      const redis = getRedis();
      const cached = await redis.get(`${REDIS_KEY_PREFIX.USER_PERMS}${userId}`);
      if (cached) permCacheBreaker.onSuccess();
      return cached ? JSON.parse(cached) : null;
    } catch {
      permCacheBreaker.onFailure();
    }
  }
  // 熔断打开 → 直走 DB 路径
  return null; // DB 路径在调用方
}
```

### 2.4 getUserPermissionContext N+1 优化

**现状**: 4 层嵌套 `db.query.users.findFirst({ with: { userRoles: { with: { role: { with: { rolePermissions: { with: { permission: ... } } } } } } } })`。

Drizzle 的嵌套 `with` 默认生成 N+1 查询（每层独立 SELECT）。改为显式 JOIN:

```typescript
const rows = await db
  .select({
    roleCode: schema.roles.code,
    permCode: schema.permissions.code,
    deptId: schema.roles.deptId,
    roleStatus: schema.roles.status,
    permStatus: schema.permissions.status,
    userStatus: schema.users.status,
  })
  .from(schema.users)
  .where(eq(schema.users.id, userId))
  .leftJoin(schema.userRoles, eq(schema.users.id, schema.userRoles.userId))
  .leftJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
  .leftJoin(schema.rolePermissions, eq(schema.roles.id, schema.rolePermissions.roleId))
  .leftJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id));
```

单次 SQL，PostgreSQL 优化器可走索引。

---

## 三、数据架构优化

### 3.1 refresh_tokens 审计增强

```sql
-- 追加审计字段（不破坏现有轮换逻辑）
ALTER TABLE refresh_tokens ADD COLUMN client_info text DEFAULT NULL;  -- 签发时的 User-Agent
ALTER TABLE refresh_tokens ADD COLUMN rotated_from_id uuid REFERENCES refresh_tokens(id);
```

`rotated_from_id` 在 `rotateRefreshToken` 中赋值：新 RT 记录 `rotatedFromId: oldRt.id`。审计时可追踪完整的 RT 轮换链。

### 3.2 授权码过期自动清理

```sql
-- cron job (pg_cron 或应用定时器): 每小时清理过期授权码
DELETE FROM authorization_codes WHERE expires_at < now() - INTERVAL '1 hour';
-- 清理已使用且超过 24h 的授权码（保留 24h 供审计）
DELETE FROM authorization_codes WHERE used = true AND created_at < now() - INTERVAL '24 hours';
```

### 3.3 复合索引追加

```sql
-- audit_logs 查询模式分析：
-- 1. 按操作类型 + 时间范围筛选
-- 2. 按用户 ID + 时间范围筛选
-- 3. 按操作类型 + 用户 ID 统计

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_op_created
  ON audit_logs (operation, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs (user_id, created_at DESC);

-- login_logs 复合索引（已有：idx_login_logs_user_event_created）
-- 补充：按 IP 分组查询异常登录
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_login_logs_ip_created
  ON login_logs (ip, created_at DESC);

-- jwks 表过期密钥扫描
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jwks_expires
  ON jwks (expires_at) WHERE expires_at IS NOT NULL;
```

### 3.4 Redis Key 命名规范化

现状: `portal:jti_blocklist:{jti}` / `portal:user_jti:{userId}` — 前缀分散在 constants。

统一为: `v2` 命名空间 + 冒号分层:

```
当前                          → 新命名            
portal:jti_blocklist:{jti}   portal:v2:jti_blocklist:{jti}
portal:user_jti:{userId}     portal:v2:user_jti:{userId}  
portal:user_perms:{userId}   portal:v2:user_perms:{userId}
portal:auth_req:{sid}        portal:v2:auth_request:{sid}
portal:auth_code:{code}      portal:v2:auth_code:{code}
portal:pkce:{verifier}       portal:v2:pkce:{verifier}
portal:refresh_dedup:{sub}   portal:v2:refresh_dedup:{sub}
portal:login_fail:{userId}   portal:v2:login_fail:{userId}
```

迁移策略: 双写双读 1 个 TTL 周期后删除旧 key。在 `getRedis` 处做 `get new OR get old` 兼容。

---

## 四、异常处理体系完善

### 4.1 错误码分层

当前错误码（`packages/contracts/src/errors.ts`）按模块分组。缺少:

```typescript
// 追加错误码
COMMON_ERRORS: {
  ...,
  SERVICE_UNAVAILABLE: 'AUTH_SSO_1008',   // 503
  RATE_LIMITED: 'AUTH_SSO_1009',          // 429
  CONCURRENT_MODIFICATION: 'AUTH_SSO_1010', // 409 (乐观锁冲突)
  MFA_REQUIRED: 'AUTH_SSO_1011',          // 403 (需 MFA)
  MFA_INVALID: 'AUTH_SSO_1012',           // 401 (MFA 码错误)
  ACCOUNT_LOCKED_MFA: 'AUTH_SSO_1013',    // 423 (MFA 锁定)
}

MFA_ERRORS: {
  MFA_NOT_ENROLLED: 'AUTH_SSO_8001',
  MFA_ALREADY_ENROLLED: 'AUTH_SSO_8002',
  MFA_SESSION_EXPIRED: 'AUTH_SSO_8003',
  WEBAUTHN_INVALID_SIGNATURE: 'AUTH_SSO_8101',
  WEBAUTHN_COUNTER_MISMATCH: 'AUTH_SSO_8102',
}
```

### 4.2 审计日志持久化缓冲

现状: `fire-and-forget` 写入 DB，应用崩溃时丢失。

引入 `AuditBuffer`:

```typescript
// lib/audit-buffer.ts
class AuditBuffer {
  private buffer: WriteAuditLogParams[] = [];
  private flushing = false;
  private MAX_BUFFER = 100;
  private FLUSH_INTERVAL = 1000; // 1s
  
  push(params: WriteAuditLogParams): void {
    this.buffer.push(params);
    if (this.buffer.length >= this.MAX_BUFFER) {
      this.flush();
    }
  }
  
  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    const batch = this.buffer.splice(0, this.MAX_BUFFER);
    try {
      await db.insert(schema.auditLogs).values(batch);
    } catch (err) {
      // 批量失败 → 摊回 buffer 末尾（非队首，优先保证新日志）
      this.buffer.push(...batch);
    } finally {
      this.flushing = false;
    }
  }
}

// 进程退出前尝试清空 buffer
process.on('beforeExit', () => buffer.flush());
```

### 4.3 rotateRefreshToken 错误收敛

现状: `rotateRefreshToken` 返回 `null` 表示失败，调用方再 throw `InvalidGrantError`。两层语义。

修复: `rotateRefreshToken` 直接 throw，调用方统一 catch:

```typescript
// 统一错误合约
export class RefreshTokenExpiredError extends DomainError {
  constructor() { super('AUTH_SSO_2024', 'Refresh Token 已过期'); }
}
export class RefreshTokenReusedError extends DomainError {
  constructor() { super('AUTH_SSO_2026', 'Refresh Token 被重复使用，已级联吊销所有会话'); }
}
```

`mapToOAuthError` 映射:

```typescript
[AUTH_ERRORS.REFRESH_TOKEN_EXPIRED]: 'invalid_grant',
[AUTH_ERRORS.REFRESH_TOKEN_REUSED]: 'invalid_grant',
```

### 4.4 层间超时控制

当前无超时传递。Gateway 使用全局 `HTTP_CLIENT` 5s 超时，但 Portal 内部无超时传播。

```typescript
// infrastructure/db/index.ts — 追加
export function getDb(options?: { timeout?: number }) {
  if (options?.timeout) {
    return drizzle(postgres(DATABASE_URL, { max: 1, connection: { timeout: options.timeout } }));
  }
  return db;
}

// 长查询路由使用短超时
const dbFast = getDb({ timeout: 1000 });  // 1s 超时
```

---

## 五、安全加固

### 5.1 DPoP Token Binding（RFC 9449）

动机: AT 泄露后任意客户端可滥用（#12）。DPoP 将 AT 绑定到特定客户端密钥对。

**设计**:

```typescript
// lib/auth/dpop.ts
export function verifyDpopProof(
  proof: string,          // DPoP Proof JWT
  accessToken: string,
  method: string,
  url: string,
): { clientPublicKey: JWK; error?: string } {
  const header = decodeProtectedHeader(proof);
  if (header.typ !== 'dpop+jwt') return { error: 'invalid_typ' };
  if (header.alg !== 'ES256') return { error: 'invalid_alg' };
  
  const payload = jwtVerify(proof, header.jwk!);
  if (payload.ath !== base64url(sha256(accessToken))) return { error: 'ath_mismatch' };
  if (isExpired(payload)) return { error: 'expired' };
  
  return { clientPublicKey: header.jwk! };
}

// 验证通过后将 jwk thumbprint 加入 Token 签名的 cnf claim
const token = await new SignJWT({ sub: userId, cnf: { jkt: thumbprint } })
  .setProtectedHeader({ alg: 'ES256', kid: keyId })
  .sign(privateKey);
```

对 userinfo / introspect / revoke 等敏感端点强制 DPoP 验证。

### 5.2 JWKS 私钥加密强制哨兵

现状: `crypto.ts` `encryptPrivateKey` 在 `JWKS_ENCRYPTION_KEY` 未配置时返回明文。

修复: 启动期哨兵检查:

```typescript
// app/api/auth/jwks/route.ts 或 next.config.ts
if (process.env['NODE_ENV'] === 'production' && !process.env['JWKS_ENCRYPTION_KEY']) {
  throw new Error('❌ 生产环境必须设置 JWKS_ENCRYPTION_KEY（64 字符 hex, AES-256-GCM）');
}
```

### 5.3 安全头全局注入

Gateway `response_filter` 或 Portal `next.config.ts headers()` 注入:

```typescript
// next.config.ts
async headers() {
  return [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-XSS-Protection', value: '0' },  // 已废弃但无害
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      ],
    },
  ];
}
```

### 5.4 限流平面统一

现状: Gateway 有进程内 `rate_limiter.rs`（20/min auth + 30/min token），Portal 无限流。

统一设计:

| 端点 | Gateway 限流 | Portal 限流 | 说明 |
|------|-------------|-------------|------|
| POST /api/auth/login | 20/min | 无（已由 Gateway 截获） | 同共享计数器 |
| POST /api/auth/refresh | 20/min | 无 | 同 login |
| POST /api/auth/oauth2/token | 30/min | 无 | 同 login |
| POST /api/auth/forgot-password | 5/min | 5/min | 双保险 |
| POST /api/auth/mfa/verify | 10/min | 10/min | 防暴力枚举 |
| POST /api/auth/oauth2/revoke | 无 | 60/min | Portal 侧 |
| GET /api/users | 无 | 100/min | Portal 侧 |

Portal 侧限流使用 `@/lib/rate-limit.ts`（内存滑动窗口，可降级 Redis）。

### 5.5 Gateway jti 黑名单一致性

现状: Gateway `verify.rs` 用 `crate::redis::exists` 检查 jti（fail-close: Redis 不可用时返回 true 拒绝请求）。Portal `revoke.ts` `isJtiRevoked` 同样 fail-close。

一致性问题: Redis 网络分区时，Gateway 侧 fail-close 拒绝合法请求，Portal 侧 fail-close 也拒绝——但 Gateway 无 Portal 兜底。应该统一为:

```
Gateway jti 检查: fail-close  (安全优先，拒绝风险低)
  — Gateway 误拒: 浏览器刷新即可触发静默续签拿到新 jti
  — Gateway 误放: AT 被冒用

Portal jti 检查: fail-close (安全优先)
  — checkPermission 失败导致 403 → 用户刷新 → 续签
```

当前行为正确，补充文档说明: Redis 分区时 Gateway 误拒持续 ≤30s（续签去重窗口）。

---

## 六、可落地实施路线图

### Phase 1 — 高优安全修复（3 天）

```
P1-1: token_hash 列明文审计 + DATABASE.md 修正
P1-2: JWKS 私钥加密强制哨兵
P1-3: 安全头全局注入（next.config.ts + Gateway response_filter）
P1-4: Portal 侧限流（forgot-password / mfa-verify）
```

### Phase 2 — 数据架构加固（3 天）

```
P2-1: getUserPermissionContext JOIN 重写（消除 N+1）
P2-2: 复合索引追加（audit_logs / login_logs / jwks）
P2-3: 授权码过期自动清理脚本
P2-4: 暴力破解 DB fallback + lastFailedLoginAt
```

### Phase 3 — 异常处理体系（4 天）

```
P3-1: AuditBuffer 持久化缓冲 + flush on shutdown
P3-2: rotateRefreshToken 统一错误契约（throw，不返回 null）
P3-3: checkPermission 熔断器
P3-4: 错误码分层追加（SERVICE_UNAVAILABLE / RATE_LIMITED / MFA 系列）
```

### Phase 4 — 功能模块扩展（5 天）

```
P4-1: MFA 基础：Schema + enum + totp.ts（使用 otplib 或自实现）
P4-2: MFA 端点：setup / verify / disable
P4-3: 账户恢复：forgot-password / reset-password
P4-4: 管理员会话管理 UI
P4-5: CORS 中间件
```

### Phase 5 — 高级安全（5 天）

```
P5-1: DPoP Token Binding（先对 userinfo / introspect 启用）
P5-2: Redis Key 命名迁移（v2 命名空间 + 双写双读兼容期）
P5-3: 限流平面统一配置表
P5-4: Redis 故障演练脚本
```

---

## 七、验证清单

| 验证项 | Phase | 方法 |
|--------|-------|------|
| token_hash 全部为 SHA-256 hex (64 chars) | P1 | `SELECT length(token_hash)=64 AND token_hash ~ '^[a-f0-9]{64}$'` |
| JWKS_ENCRYPTION_KEY 缺失时生产启动拒绝 | P1 | `NODE_ENV=production pnpm start` 应报错退出 |
| 安全响应头存在 | P1 | `curl -sI https://localhost:19443 | grep -i 'X-Content-Type-Options'` |
| N+1 消除：getUserPermissionContext 单 SQL | P2 | Drizzle 日志确认 1 条 SELECT，非 5+ 条 |
| 审计日志应用重启不丢失 | P3 | kill -15 后残留日志 ≤ buffer 上限 |
| token 过期返回正确的 oauth error | P3 | `invalid_grant` 非 `server_error` |
| MFA 启用后无 MFA 的 OAuth 流程被阻断 | P4 | 登录 → authorize → 要求 MFA → 完成 |
| DPoP 下 AT 泄露无法被其他客户端使用 | P5 | 复制 AT 到 curl → userinfo 返回 400 `use_dpop_proof` |
