# 2026-09-28 设计审计修复：OAuth Client 收敛、幽灵表清除、故障语义分级、协议合规

> 来源：2026-09-28 全链路设计审计 + 业界标准复核（RFC 9700 / IETF Browser-Based Apps BCP / OIDC Discovery & Core / RFC 7662 / OCSP 先例 / Kong·Keycloak 实践）。
> 关联 ADR：ADR-010（统一 OAuth Client）、ADR-011（故障语义分级）、ADR-012（OIDC 协议合规）；ADR-004/006 修订。

## 修复清单

| 问题 | 修复 | 位置 |
|---|---|---|
| H-1 多 upstream OAuth callback 错位（结构性） | 一期止血：`validate_routing_consistency` 强制全 upstream 凭据一致，否则拒绝启动 | `apps/gateway/src/config.rs` |
| H-2 `access_tokens` 幽灵表：管理端撤销 DELETE 空表却返回成功 | DROP 表（migration 0001）+ 管理端撤销改为按 client 撤 RT（真实生效） | schema/auth.ts、clients/actions.ts、api/clients/[id]/tokens |
| introspect 读幽灵表，scope/client_id 恒空 | AT 分支无状态化（签名+exp+iss+jti 黑名单），scope 语义由 RT 分支提供 | api/auth/oauth2/introspect |
| RT user-level：重放级联撤全部会话（RFC 9700 family 违背） | RT 绑定 `client_id`（回填 `'portal'`），重放级联收窄为 (userId, clientId) | schema、token.ts、token/route.ts |
| CSRF 层缺位（BCP mandatory） | proxy.ts 对写请求做同源校验（TrustedOrigins + Gateway 权威 X-Forwarded-Host + Host）；`/oauth/error` 放行、`/oauth2` 死配置移除 | src/proxy.ts |
| jti fail 语义文档反转 | 代码不动，ADR-004/ARCHITECTURE.md 对齐 fail-close；沉淀 ADR-011 | docs |
| JWKS 无就绪门控 / 无 UnknownKid 刷新 / 全量替换 | 覆写 `start_with_ready_notifier`（首刷≤5 次后放行）+ `add_dependency`；UnknownKid 单飞节流触发按需刷新；刷新结果合并宽限 24h | jwks.rs、verify.rs、main.rs |
| 限流阈值硬编码 E2E 值（200/300 裸奔上线） | 配置化 `RateLimitConfig`（默认 20/30）+ `RATE_LIMIT_*` env 覆盖；E2E 在 compose.test.yml 抬档 | config.rs、rate_limiter.rs、docker-compose.test.yml |
| 配置缺失静默回退默认（指向 localhost） | fail-fast；仅 `GATEWAY_ALLOW_DEFAULT_CONFIG=1` 放行；生产判定改 `gateway.environment`（NODE_ENV 兼容回退） | config.rs |
| issuer `'auth-sso'` 非 URL（违反 OIDC Discovery §4.3） | env 驱动（`getIssuer()`），过渡窗当日关闭：`LEGACY_ISSUER` 已双端删除，验签仅接受 URL issuer | token.ts、openid-configuration route、jwks.rs |
| RT 绑定后 token 端点未强制归属校验（自查补漏） | `rotateRefreshToken(old, expectedClientId)`：token 端点必传；不匹配视同泄露，家族撤销 | token.ts、oauth2/token/route.ts |
| departments cacheTag 失效断链（下拉最长陈旧 1h） | 写操作补 `updateTag('departments')` | departments/actions.ts |

## 显式取舍（非缺陷，记录防"文档再说反话"）

- **`/api/auth/logout` 保留 GET**：它是 OIDC RP-Initiated Logout 的 `end_session_endpoint`（浏览器顶层 GET 导航，改 POST 会破坏协议语义）。logout-CSRF 属业界公认低危 nuisance（RFC 9700 未要求），受 SameSite=Lax 兜底。
- **H-1 二期（oauth 配置面上移 `[gateway.oauth]`）**：一期校验已止血，二期改动面大（config/main/gateway/e2e），按 ADR-010 排期。

## 环境修复（同日）

- **Node 26 口径统一**：nvm default 26（v26.10.0）+ `engines >=26.0.0`（原 `>=20`）+ CI 镜像本为 `node:26-alpine`——三处口径对齐。
- **Temporal 运行时 flag**：Node 26 仍需 `--harmony-temporal`（`Dockerfile.vercel` CMD 早已内置）。此前 vitest 从未携带该 flag，domain 层 17 个测试在任何本地环境都无法通过（CI 的 node:26-alpine 恰好未暴露）。现已固化于 `vitest.base.ts`（`poolOptions.forks.execArgv`）与 portal dev/start 脚本，AGENTS.md 标注勿删。
- **本地验证基础设施**：UOS 20（Debian 10）无 Docker 且仓库版 redis 5.0.3 缺 GETDEL——改用用户态嵌入式 PostgreSQL 16（`embedded-postgres`）+ 源码编译 Redis 7.2.5，与 CI 基线版本一致，迁移与全量测试均在真实服务上执行验证。

## 最佳实践（沉淀）

1. **没有编译期隔离的"预留"就是公开 API**。预留表/预留字段若不以 feature flag 限定，会被后续消费链路当真数据使用（本次 introspect/管理端假撤销的根因）。预留必须可证伪：要么零消费者，要么删除。
2. **故障语义按数据性质决定，不按组件决定**：否决性安全数据（黑名单）fail-close；缓存性授权数据（权限上下文）fail-open 降级真源。写文档时先给数据分类，再写策略；语义翻转必须过 ADR（本次 jti 语义翻转只改了代码注释，四份文档原地说反话）。
3. **造型要跟着决策走**：ADR-003 说单 Client、RBAC 删了 role_clients、AT 去掉 client 语义，config 里 per-upstream client 造型却还活着 —— 三者不同步产生结构性 bug。重构后 grep 旧概念的所有残留。
4. **Gateway 侧 JWKS 消费的业界三件套**：unknown kid → 单飞 refetch（最小间隔节流，防坏 token 风暴）+ 重试一次；签发方轮换期新旧 key 并存（网关侧=合并宽限）；就绪门控必须覆写 `start_with_ready_notifier` 且声明 `add_dependency` —— 只在 `start()` 里阻塞约束不到其他服务。
5. **管道会吃掉退出码**：`cargo clippy ... | tail` 的成功假象差点让未编译过的基线混进评审；同日再次踩中 `pnpm typecheck 2>&1 | tail -1 && pnpm test` —— 管道退出码是 tail 的，`&&` 形同虚设，typecheck 失败被吞。门禁命令永远直接看退出码（`echo EXIT=${PIPESTATUS[0]}`），或干脆不用管道串联门禁。
6. **迁移文件的单一真相**：本仓库 `db:migrate` 走 `scripts/migrate.ts` 顺序执行 `drizzle/*.sql`（容忍幂等错误），meta journal 与手写基线 SQL 本就脱节 —— `drizzle-kit generate` 会产出全量建表（0001_goofy_lilith 已验证并移除）。增量迁移一律手写（含存量数据回填顺序：加列→回填→设 NOT NULL→FK→索引），**不要**在本仓库运行 `db:generate`。
