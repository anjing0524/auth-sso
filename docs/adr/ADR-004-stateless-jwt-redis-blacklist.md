# ADR-004: 无状态 JWT + Redis jti 黑名单

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | accepted                              |
| **日期**   | 2026-07-15                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | JWT 签发/验签、Redis、`access_tokens` 表 |

## 背景

OAuth 2.1 的 Access Token 有两种主流方案：
- **Opaque Token**（如随机字符串）：需要每次请求回调 AS 校验 → 强一致性，高延迟
- **JWT（自包含）**：离线验签，无需回调 AS → 低延迟，但撤销困难

Gateway 离线验签是核心性能要求（避免每次请求回调 Portal），因此选择 JWT。但 JWT 的固有问题是无状态撤销——签发后到过期前无法主动失效。

## 决策

**JWT 无状态签发 + Redis jti 黑名单实现紧急撤销。**

架构：

```text
签发: Portal 生成 JWT → jti 写入 Redis 白名单 (portal:user_jti:{userId})
验签: Gateway 解码 JWT → ES256 本地验签 → Redis EXISTS portal:jti_blocklist:{jti}
撤销: Portal 将 jti 加入黑名单 → 删除 user_jti 映射
续签: Gateway 检测 exp < 300s → 用 refresh_token 换新 JWT
```

Redis 键空间：

| Key                              | 性质            | TTL       | 用途                     |
|----------------------------------|-----------------|-----------|--------------------------|
| `portal:jti_blocklist:{jti}`    | Source of Truth | 略长于 JWT | 紧急撤销，Gateway 每次验签后检查 |
| `portal:user_jti:{userId}`       | Source of Truth | 永久       | 用户→当前有效 jti 映射，用于批量撤销 |
| `portal:user_perms:{userId}`     | Cache           | 3600s      | 权限缓存，可从 DB 重建       |

`access_tokens` 表**继续预留**，不删除。当前不参与 JWT 生命周期，但为未来可能的 opaque token 模式保留扩展点。

## 容错策略

Redis 不可用时 **fail-open**：
- `jti_blocklist` 不存在 → 跳过黑名单检查（JWT 视为有效）
- `refresh_dedup` 失败 → 跳过去重锁（允许并发续签，非致命）
- 连接池初始化失败 → Gateway 退出启动（fail-fast 兜底）

Redis 是核心依赖，生产环境使用集群部署。无需额外 PostgreSQL 灾备。

## 后果

- **低延迟**：Gateway 本地 ES256 验签，Redis EXISTS 检查是唯一次网络调用
- **撤销窗口**：JWT 签发后到下一次 Gateway 验签之间的请求无法撤销（但续签检测 300s 窗口限制了这个风险）
- **Redis 依赖**：Redis 不可用时撤销失效，这是明确接受的权衡

## 相关 ADR

- ADR-003: Gateway 作为统一 OAuth Client
- ADR-005: 三层安全模型（Gateway 执行离线验签）
