# ADR-011: 故障语义分级 —— 否决性数据 fail-close，缓存性数据 fail-open

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | accepted (2026-09-28，代码现状自洽，文档对齐) |
| **日期**   | 2026-09-28                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | Gateway jti 黑名单检查、Portal 权限缓存、ADR-004/006 修订 |

## 背景

本系统存在两类性质相反的 Redis 数据，历史上文档与代码对它们的故障策略各说反话：

| 数据 | 性质 | 代码实况 | 旧文档 |
|---|---|---|---|
| `portal:jti_blocklist:{jti}` | **否决性安全数据**（存在 = 拒绝） | fail-close：Redis 不可用/2s 超时/命令异常 → 拒绝请求（`redis.rs` `exists()`，注释详实） | ADR-004 写 fail-open |
| `portal:user_perms:{userId}` | **缓存性授权数据**（DB 永远是真源） | fail-open：Redis 异常 → DB 回退重建（`permissions.ts`） | ADR-006 写 fail-closed 无降级 |

两组语义在文档与代码之间完全镜像反转。逐一修正后确认：**代码的组合是自洽的，错的是文档**。

- 对否决数据 fail-open，意味着漏放一个已被撤销的凭据 —— 安全事故；且业界先例（OCSP/CRL 二十年）中 soft-fail 被主流视为"几乎无价值的伪撤销"（Chrome 安全 FAQ）。
- 对缓存数据 fail-closed，意味着 Redis 单点故障 = 全站管理功能死亡 —— 而 DB 本来就能重建缓存，拒绝服务毫无安全收益。
- 若按旧文档反向修改代码，两个都会被改错。

## 决策

**按数据性质（而非组件）决定故障策略：**

1. **否决性安全数据（jti 黑名单）→ fail-close**。已认证流量的可用性由 Redis HA（ADR-004 已要求集群）保障，而非语义降级；`redis.rs` 的 2s 获取超时是延迟界的兜底，不是可用性开关。拒绝引入"紧急切换 fail-open"的运行时开关 —— 那是一个安全后门，正确运维动作是修复 Redis。
2. **缓存性授权数据（权限上下文）→ fail-open 降级 DB**。DB 是永久真源，Redis 只是可重建缓存（ADR-004 的键空间表本就如此定性）。
3. **拓扑性推论**：外部子应用（ADR-007）没有 DB 访问能力，其权限读取天然 fail-closed —— ADR-006 的原始精神在子应用侧自动成立，无需代码分叉。
4. 降低撤销依赖的正确杠杆是**短 AT TTL（1h）**（OCSP 业界的等价物是短有效期证书），而非 fail-open。

## 后果

- Redis 运行时故障 = 已认证流量 401（fail-close 的显式代价）。缓解：启动期 readiness 门控、2s 超时防饿死、`inc_redis_acquire_failures` 指标、Redis HA。
- 权限上下文在 Redis 故障期退化为每请求 DB 查询（约 2 次往返），性能降级但不拒绝服务。

## 2026-10-29 补充：撤销写入与缓存刷新残余（已接受）

- **JTI 黑名单读取**仍按本 ADR fail-close（Gateway 不可用即拒绝），本次未改。
- **撤销写入 / 权限缓存刷新失败**保持降级：`revokeAndRefreshAuthorization` 只记录失败计数，不阻断已提交的权限变更；补偿控制为短 AT TTL（≤1h）、`checkPermission` 在权限上下文不可用时 fail-close、身份读口过滤 DISABLED/DELETED 用户。
- 残余窗口：Redis 缓存仍持有旧权限时，降权用户可能保留旧权限至缓存 TTL；本轮**接受**该风险，不引入运行时 fail-open 开关。
- **CI 浏览器预装**：`scripts/ci/e2e.sh` 在 Playwright 官方镜像内执行 `pnpm exec playwright install chromium` 后再跑全量 E2E；本地可用 `E2E_CHANNEL=chrome` 复用系统 Chrome。

## 相关 ADR

- ADR-004: 无状态 JWT + Redis jti 黑名单（fail-open 条款由本 ADR 取代）
- ADR-006: JWT 最小化（fail-closed 条款由本 ADR 修正为"Portal 内 fail-open / 子应用拓扑性 fail-closed"）
