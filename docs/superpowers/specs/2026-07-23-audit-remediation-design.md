# 审计问题整治设计

> 日期：2026-07-23
> 状态：已确认，待实施

## 目标

修复 `docs/audit/2026-07-23-code-audit.md` 中仍适用的问题，同时将数据库重置为可从空 PostgreSQL 一次初始化的唯一基线。

## 历史 ADR 对齐结论

本次设计以已实施的 ADR-006、ADR-007、ADR-008、ADR-009 为优先约束；审计结论与这些 ADR 冲突时，以 ADR 和本次用户确认的产品决策为准，并在审计报告中勘误。

| 决策 | 权威来源 | 本次处理 |
|---|---|---|
| JWT 最小化，`iss`/`aud` 都为 `auth-sso` | ADR-006 | 保留。AT 只承载身份、JTI、标准 claims 和已授权 scope；不重新嵌入权限或 client 身份。 |
| Gateway 不负责鉴权 | ADR-007 | 保留。Gateway 不查询 Redis 权限、不按 client 分发权限，只注入身份。 |
| 权限码为 `{clientId}:{resource}:{action}` | ADR-008 | 保留。Portal 所有守卫改用 contracts 常量，修正旧无前缀调用。 |
| RT 是用户级、去 clientId | ADR-006 | 保留。撤销不做 token-client 属权校验；client 认证仍是 OAuth 端点调用方门槛。 |
| Gateway 统一 OAuth Client、所有 upstream 强制 secret | ADR-003、ADR-009 | 保留。shared secret 的生产 fail-fast 是对既有 HMAC 信任路径的补强。 |
| Gateway `validate_aud = false` | ADR-006、详细设计 §6 | 保留并增加回归测试；此前审计把它列为安全缺陷是误报。 |
| Gateway 必须校验 issuer | ADR-005、ADR-006、详细设计 §6 | 修复。缺 issuer 的 Discovery 刷新不得生成弱化 validation。 |
| `access_tokens` 预留 future opaque-token 能力 | ADR-004 | 保留表和 `client_id` 审计字段；它不改变 AT/RT 为全局用户会话令牌的决策。 |

ADR-001、ADR-002 的统一权限树与角色-部门数据范围均不在本次改变范围内。历史计划中与已实施 ADR 冲突的旧描述仅作为背景，不作为实现依据。

## 已确认的令牌模型

- Access Token（AT）与 Refresh Token（RT）是**用户会话令牌**，不记录、不验证 `client_id`。
- JWT audience 固定为 `auth-sso`。Gateway 有意不校验 audience；它只校验 ES256 签名、固定算法、issuer、有效期和 JTI 撤销。
- OAuth client 仍是授权入口边界：authorize/token/revoke 端点必须验证 client 状态和凭据；authorization code 绑定 client 与 redirect URI。
- 请求 scope 必须是该 OAuth client 注册 scopes 的子集。兑换后 scope 写入 AT 的标准 `scope` claim，RT 同样保存 scopes；二者均不保存 client。
- UserInfo 仅基于 AT 已授予 scope 投影：始终返回 `sub`；`profile` 加 name/preferred_username/picture；`email` 加 email/email_verified。
- RFC 7009 revoke 对已认证 client 提供幂等成功响应；在上述全局会话模型下，不实施 token-client 属权检查。

## 数据库基线

1. 删除现有 `apps/portal/drizzle/0000` 至 `0005` 与历史 snapshots/journal；项目明确授权重置，因此不支持在旧数据库上原地升级。
2. 依据 Drizzle schema 及本设计生成唯一初始化迁移和新 metadata：
   - `authorization_codes.client_id`、`access_tokens.client_id` 保留为授权流程/管理审计所需的关系；`refresh_tokens` 不含 client。
   - `user_roles`、`role_permissions` 用真实复合主键。
   - `permissions` 使用当前三值 permission_type 与 namespace code 模型。
   - `access_logs` 使用 `PARTITION BY RANGE (created_at)`；因 PostgreSQL 分区唯一键必须包含分区键，主键为 `(id, created_at)`。
   - 初始化 SQL 创建当前月和下月分区；维护脚本仅负责预建未来分区和删除超过 180 天分区。
3. `db:push` 限定本地临时开发；CI 使用空 PostgreSQL 的 `db:migrate` 后再 seed/test。

## 安全与正确性设计

### OAuth / OIDC

- 授权码兑换使用单条条件 `UPDATE ... WHERE code AND client_id AND used=false AND expires_at>now() RETURNING` 原子领取。领取失败统一为 `invalid_grant`；PKCE 校验失败时同样不可再次使用该 code，防止 verifier 穷举。
- scope 在 domain 层按空白字符分词、去重、验证 token 格式；authorize 在写 authorization code 前校验请求 scopes 为 client scopes 子集。ID Token 仅在 scope 集合包含精确 `openid` 时发行。
- discovery、ID token、Access Token 的 issuer 统一固定为 ADR-006 的 `auth-sso`；audience 同样固定为 `auth-sso`。
- telemetry 的审计主体只能来自 `withPermission` 回传的当前 userId，客户端 body 不再决定主体。

### Gateway

- 明确保留 `validate_aud = false`，并在规范/测试中锁定该决策。
- Discovery 元数据缺少 issuer、issuer 非预期格式，或 refresh 解析失败时，刷新操作失败且保留 ArcSwap 中最后有效 JWKS/validation 快照；启动首次加载失败则拒绝启动。
- production 必须有长度合格的 `GATEWAY_SHARED_SECRET`，Portal 和 Gateway 均启动期 fail-fast。

### 韧性与运维

- Redis 设置连接超时、有限重试并禁用 offline queue；鉴权调用保留已有 DB 回退/安全语义。
- 用户批量权限缓存刷新和 JTI 撤销按固定批次、有界并发执行，并返回/记录失败项。
- Gateway Dockerfile 固定 Alpine 版本（随后可由依赖更新流程升级）。
- Gateway 提供受限 metrics 输出；分区维护纳入可执行的部署/CI 定时任务，并记录成功、失败和清理数量。

## 测试策略

先写失败测试，再写最小实现。必须覆盖：

1. 同一 authorization code 的并发兑换只有一个成功；
2. client 不能请求未注册 scope，`notopenid` 不产生 ID Token；
3. UserInfo 的 `openid`、`profile`、`email` 三种投影；
4. route/action 真实使用 contracts 权限常量；
5. Discovery issuer 缺失不替换当前 Gateway 验签快照，且 audience 仍明确不校验；
6. 全新数据库 `db:migrate` 成功，分区表可写、维护脚本可预建/清理；
7. production 缺 shared secret、Redis 断连策略、批量处理上限的回归验证。

## 非目标

- 不重新引入 RT 的 client 绑定或 per-client JWT audience。
- 不实现旧数据库在线迁移、数据回填或兼容层。
- 不在本次无关重构中拆分 token.rs / gateway.rs，除非实现边界必须最小化提取函数。
