# ADR-006: JWT 最小化 — 身份断言与鉴权数据分离

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | implemented (2026-07-16)              |
| **日期**   | 2026-07-15                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | JWT Claims 结构、Gateway 验签、Portal Token 签发、子应用鉴权 |

## 背景

当前 JWT Access Token (AT) 的 `PortalJwtClaims` 包含：

```typescript
interface PortalJwtClaims {
  sub: string;           // 用户 ID
  jti: string;           // 撤销标识
  roles: string[];       // 角色编码列表
  permissions: string[]; // 权限编码列表
  deptIds: string[];     // 角色部门子树 ID 列表
}
```

存在三个问题：

1. **权限变更即时性**：角色/权限/部门变更后，已签发的 JWT 中权限数据过期，最长 1 小时（AT TTL）才能生效。非紧急变更走 jti 黑名单太重，自然过期太慢。
2. **Token 膨胀**：管理员用户可能拥有 30+ 权限码，全部打入 JWT Claims 导致 Cookie 体积增大。
3. **Gateway 职责越界**：Gateway 当前只做离线验签 + jti 黑名单检查，不消费 `permissions[]` / `deptIds[]` / `roles[]`。这些字段完全是为了注入 upstream 而存在的——但注入的内容 Gateway 自身不需要理解。

## 决策

**JWT 最小化：AT 仅保留身份断言，鉴权数据全部剥离到 Redis。**

```typescript
// 新 JWT Claims 结构
interface PortalJwtClaims {
  sub: string;           // 用户 ID — 身份断言
  iss: string;           // "auth-sso" — 体系级签发者
  aud: string;           // "auth-sso" — 体系级受众
  jti: string;           // 撤销标识
  iat: number;           // 签发时间
  exp: number;           // 过期时间
}
```

- **删除** `roles[]`、`permissions[]`、`deptIds[]`
- **`aud`** 从 `"portal-client"` 改为 `"auth-sso"`（体系级标识，所有子应用共用）
- **`iss`** 统一为 `"auth-sso"`

### 鉴权数据存放

用户权限上下文（角色、权限、部门范围）**仅存储在 Redis**：

```
Key: user:{sub}:perms
Value: {
  roles: string[],
  permissions: string[],
  deptIds: string[]
}
```

### 三层架构的职责边界

| 层 | 组件 | 职责 | 鉴权数据来源 |
|----|------|------|-------------|
| L1 | Gateway | JWT 离线验签（签名 + exp + jti 黑名单）→ 注入 `X-User-Id` | 不读取权限 |
| L2 | proxy.ts | Cookie 存在性检查 + CSRF | 不读取权限 |
| L3 | 子应用 | 自取 Redis 权限 + 本地对比校验 | Redis |

### 撤销策略

- **紧急撤销**（密码泄露/安全事件）：jti 黑名单 → Gateway 拒绝旧 JWT → 强制重新登录
- **非紧急变更**（角色/权限调整）：Portal 更新 Redis 中的 `user:{sub}:perms` → 子应用下次请求实时获取 → 即时生效
- **JWT 续签**：Gateway 在 AT 即将过期时（< 5min）调用 Portal `/api/auth/refresh` → 签发新 AT（新的 `exp`）

### Redis 可用性策略

Redis 是鉴权数据唯一来源，**不可用时系统不可用（fail-closed）**。不设降级路径（如 LRU 缓存或 JWT 内嵌权限），以降低架构复杂度。

## 后果

### 正面

- 权限变更**即时生效**（下一次请求即可获取最新权限）
- JWT **体积极小**（仅标准 claims + sub + jti），Cookie 远低于 4KB 上限
- Gateway **职责极简**（纯身份验证，不碰权限数据）
- 架构清晰：身份归属 Gateway，鉴权归属子应用

### 需承担

- 每个请求子应用需 `GET user:{sub}:perms`（Redis 单实例轻松 100K+ QPS）
- Redis 变成鉴权单点，必须保证高可用（Sentinel/Cluster）
- 子应用需要 Redis 连接能力

## 替代方案

| 方案 | 评估 | 结论 |
|------|------|------|
| JWT 内嵌 `perm_version` + Gateway LRU | 时序窗口问题、缓存一致性复杂 | 拒绝 |
| Gateway 定时同步 Redis 到内存 | 复杂度高、同步延迟不可控 | 拒绝 |
| Gateway 每次请求查 Redis 做权限过滤注入 | Gateway 职责过重、每次查 Redis 和子应用自取无区别 | 拒绝 |
| JWT 保留短 TTL (5min) + sliding refresh | 仍有最多 5min 延迟，且刷新频率过高 | 拒绝 |

## 相关 ADR

- ADR-004: 无状态 JWT + Redis jti 黑名单（jti 撤销机制）
- ADR-005: 三层安全模型（Gateway 验签/子应用鉴权分层）
- ADR-007: 子应用自取权限 — Gateway 不管鉴权
- ADR-008: 权限码命名空间化模型
