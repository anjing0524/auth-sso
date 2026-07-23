# ADR-007: 子应用自取权限 — Gateway 不管鉴权

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | implemented (2026-07-16)              |
| **日期**   | 2026-07-15                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | Gateway 架构、子应用架构、Redis 访问模型 |

## 背景

ADR-006 决定将鉴权数据从 JWT 剥离到 Redis 后，需要决策**谁从 Redis 读取权限并执行鉴权**。

两种可行方向：

1. **Gateway 分发模式**：Gateway 每次请求查 Redis → 按 Client 前缀过滤权限 → 注入 upstream
2. **子应用自取模式**：Gateway 只注入 `X-User-Id` → 子应用自己查 Redis 拿权限 → 自己校验

## 决策

**子应用自取权限。Gateway 只做身份断言注入（`X-User-Id`），不做任何权限相关操作。**

### 架构流

```
Gateway（身份层）:
  提取 JWT → 离线验签（签名 + exp + jti）→ 注入 X-User-Id: {sub}
  ✅ 做：JWT 验签、jti 黑名单检查
  ❌ 不做：Redis 权限查询、权限过滤、权限注入

子应用（鉴权层）:
  收到请求 + X-User-Id
  → Redis GET user:{sub}:perms
  → 按 client_id 前缀过滤权限: "app-b:user:read"
  → 对比本地 RequiredPermissions
  → 放行 / 403
```

### 选择子应用自取的理由

| 维度 | Gateway 分发 | 子应用自取 |
|------|-------------|-----------|
| Gateway 复杂度 | 高 — 需理解权限 code 前缀 + client 映射 | 低 — 只管身份 |
| 即时性 | Gateway 查 Redis = 即时 | 相同 |
| 架构解耦 | Gateway 耦合权限模型 | 权限模型变更只影响子应用 |
| 故障隔离 | Gateway 故障影响所有子应用鉴权 | Redis 故障各子应用独立受影响 |
| 第三方接入 | Gateway 必须知道所有 Client 的权限前缀 | 第三方只需 Redis 连接 |
| 安全模型 | Gateway 是权限分发的信任根 | 信任模型：所有内部子应用共享 Redis |

### 安全模型

采用**信任模型**（无 Redis ACL 隔离）：所有内部子应用共享同一个 Redis 实例，可以读取任意 `user:{sub}:perms`。这是当前阶段最简选择，未来如需隔离可引入 `user:{sub}:perms:{clientId}` 分 Key + Redis ACL。

### 子应用鉴权伪代码

```typescript
// 子应用中间件
async function authorize(request) {
  const userId = request.headers['x-user-id'];
  if (!userId) return 401;

  const permsData = await redis.get(`user:${userId}:perms`);
  if (!permsData) return 401;  // Redis 不可用

  const { permissions } = JSON.parse(permsData);
  const requiredPermissions = getRequiredPermissions(request);

  const hasAll = requiredPermissions.every(perm =>
    permissions.includes(perm)
  );
  if (!hasAll) return 403;

  return next();
}
```

## 后果

### 正面

- Gateway 职责极简（纯身份验证）
- 架构解耦：Gateway 不需要理解权限模型
- 第三方接入简单：只需 Redis 连接 + 本地声明所需权限

### 需承担

- 子应用必须集成 Redis 客户端
- 每个请求一次 Redis GET（QPS 可控）
- Redis 是鉴权单点（ADR-006 已确认 fail-closed）

## 相关 ADR

- ADR-006: JWT 最小化 — 身份断言与鉴权数据分离
- ADR-008: 权限码命名空间化模型
- ADR-003: Gateway 作为 OAuth Client
