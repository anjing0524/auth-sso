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

`access_tokens` 表~~继续预留，不删除~~ **已于 2026-09-28 删除**：无编译期隔离的"预留表"被三条消费链路当真表使用（introspect 恒空数据、管理端撤销为静默 no-op 却返回成功），详见 ADR-012。Opaque token 扩展点若未来需要，以显式 schema 变更 reintroduce。

## 容错策略

（2026-09-28 修订：jti 检查的故障语义由 fail-open 改为 **fail-close**，与代码实现对齐，依据见 ADR-011。）

Redis 不可用时的分级策略：

- `jti_blocklist`（否决性安全数据）→ **fail-close**：Redis 不可用/2s 超时/命令异常一律拒绝请求（`redis.rs` `exists()`）。业界先例（OCSP）中 soft-fail 被视为伪撤销；降低撤销依赖的正确杠杆是短 AT TTL（1h）。
- `refresh_dedup` 锁（辅助数据）→ fail-open：跳过去重锁（允许并发续签，非致命）
- 连接池初始化失败 → Gateway 退出启动（fail-fast 兜底）

Redis 因此是**可用性关键依赖**（fail-close 的显式代价），生产环境使用集群部署。无需额外 PostgreSQL 灾备。

## 后果

- **低延迟**：Gateway 本地 ES256 验签，Redis EXISTS 检查是唯一次网络调用
- **撤销窗口**：JWT 签发后到下一次 Gateway 验签之间的请求无法撤销（但续签检测 300s 窗口限制了这个风险）
- **Redis 依赖**：Redis 不可用时撤销失效，这是明确接受的权衡

### 有意接受：RFC 7009 §2.1 撤销级联（2026-09-29 记录，2026-09-30 定案）

RFC 7009 §2.1 规定撤销 Refresh Token 时 SHOULD 级联撤销同授权 grant 的全部 Access Token。本项目**有意不实现**该级联（2026-09-30 /grill-with-docs 定案，详见 ADR-013 决策 4）：ADR-013 落地 per-client aud + client_id claim 后技术上已可定位 (userId, clientId) 家族，但 AT TTL 1h 是 ADR-011 §4 认可的正确撤销杠杆（泄露 AT 残余风险 ≤1h），RT 家族撤销（RFC 9700 §4.14）已闭合续期能力；per-family 活跃 jti 集合需新 Redis 键空间 + 成员级过期 + 签发写放大，与 SHOULD（非 MUST）收益不成比例。若降级为撤销用户全部 jti 仍会跨 client DoS 放大，继续排除。重评触发：AT TTL 延长、对标 FAPI 2.0、合规审计强制级联。分析详见 docs/research/2026-09-29-oidc-oauth2-provider-practices.md §3/§5 与 docs/plans/2026-09-29-research-fixes-implementation-plan.md（D2）。

## 相关 ADR

- ADR-003: Gateway 作为统一 OAuth Client
- ADR-005: 三层安全模型（Gateway 执行离线验签）
