# ADR-012: OIDC 协议合规对齐 —— issuer URL 化、RT 绑定 client、introspect 无状态化

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | implemented (2026-09-28)              |
| **日期**   | 2026-09-28                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | JWT iss/验签、refresh_tokens 表、introspect/revoke 端点、Client Token 管理界面 |

## 背景

2026-09-28 全链路设计审计 + 业界标准复核（RFC 9700 / OIDC Discovery & Core / RFC 7662）发现三处协议级偏差：

1. **issuer 非 URL**：`issuer: 'auth-sso'` 违反 OIDC Discovery §4.3（issuer 必须与 discovery URL 同源）与 Core §3.1.3.7（RP MUST 校验 iss）—— 标准第三方 RP 无法接入。`packages/config` 的 `getIssuer()`（`PORTAL_ISSUER` 覆写、默认 `NEXT_PUBLIC_APP_URL`）实现完整却零调用。
2. **RT 为 user-level**（schema 注释明示"不绑定 Client"）：RFC 9700 §4.14 的重放撤销模型是 **token family/grant** —— 撤销范围是"同一授权"，而 user-level RT 没有 family 概念，重放级联被迫撤该用户**全部** client 的会话（跨 client DoS 放大）。Keycloak 等主流 AS 的 RT 均绑定 user+client session。
3. **`access_tokens` 幽灵表**：ADR-004 的"预留表"被三条消费链路当真表使用 —— introspect 的 scope/client_id 恒空串（RFC 7662 语义残缺）、Client Token 管理列表恒空、管理端撤销动作 DELETE 空表却返回成功（**虚假安全反馈**）。RFC 7662 中除 `active` 外全部字段可选，无状态验证 + jti 黑名单即可给出诚实响应。

## 决策

### 1. issuer 迁移（双接受过渡窗已于 2026-09-28 当日关闭）

- 签发（login_session/AT/id_token）与 Discovery 一律改用 `getIssuer()`：`PORTAL_ISSUER` 优先，默认 `NEXT_PUBLIC_APP_URL`（OIDC 规范要求 issuer 与 discovery URL 同源）。
- 过渡窗设计为"Portal 与 Gateway 双接受 `[新 URL issuer, 'auth-sso']` 一个发布周期"；因系统尚无生产存量 token（仅开发环境），**窗口当日即关闭**——`token.ts` 与 `jwks.rs` 的 `LEGACY_ISSUER` 常量已删除，验签只接受新 URL issuer。
- Gateway 的 issuer 取自 discovery，无需配置变更。`aud` 保持体系级 `PORTAL_AUD = 'auth-sso'` 不变（ADR-006 既定）。
- `aud` 保持体系级 `PORTAL_AUD = 'auth-sso'` 不变（ADR-006 既定）。

### 2. RT 绑定发放 client（RFC 9700 family 最小语义）

- `refresh_tokens` 新增 `client_id NOT NULL FK → clients`（历史行回填 `'portal'`：Gateway 统一换 token 的 SSO 会话）。
- `issueRefreshToken` 增加 clientId 参数；轮换沿 `rt.clientId` 传递，Gateway 续签链路无感知。
- **sender 绑定强制**：token 端点 refresh grant 必须校验提交的 RT 归属当前认证 client（`rotateRefreshToken(old, expectedClientId)`），不匹配视同泄露信号——撤销整个授权家族并拒绝；Gateway 静默续签（`/api/auth/refresh`）无 client 上下文，不做此校验。
- 重放级联撤销范围从 `WHERE userId` 收窄为 `WHERE (userId, clientId)` —— 同一授权家族，不再横扫其他 client 的会话。
- 已知边界：AT 无 client 语义，无法按 client 定点撤销 AT，已发 AT 在 ≤1h TTL 内自然失效；急迫场景走 jti 黑名单强制下线。终极方向是 sender-constrained token（DPoP/mTLS），本期不做。

### 3. 删除 `access_tokens` 幽灵表，introspect 无状态化

- `DROP TABLE access_tokens`（migration 0001）；ADR-004 的"预留"条款废止 —— 没有编译期隔离的"预留"就是等着被误用的公开 API。
- introspect 的 AT 分支改为纯无状态：`verifyAccessToken`（签名 + exp + iss + **jti 黑名单**，Redis 故障 fail-close）→ 返回 `active/sub/token_type/exp/iat/iss/jti`；scope/client_id 诚实省略（RFC 7662 可选），scope 语义由 RT 分支提供（RT 行自带 scopes）。
- 管理端"撤销 Client Token"改为真实动作：按 client 撤销其名下 RT（终止续期能力），列表数据源改为该 client 的活跃 RT。协议层的 per-token 撤销继续走 RFC 7009 `/revoke`（本就正确）。

### 4. 分层备忘（对 ADR-006 的精确化）

ADR-006 剥离 JWT claims 时把两类数据混在了一起：**RBAC 鉴权数据**（roles/permissions/deptIds，剥离正确）与 **OAuth 协议数据**（scope/client/aud，业界 AT 普遍携带）。当前 BFF 单一体系内无碍；第三方 RS 上量后，正确演进是把 OAuth 协议字段加回 AT（aud=各 RS、scope、client_id），RBAC 数据继续留在 Redis。

（2026-09-30 已定案：由 **ADR-013** 落地为完整决策——AT `aud = client_id` + 显式 `client_id` claim、Gateway aud 校验自动推导常开、RFC 7009 AT 级联有意接受。）

## 后果

- 标准 OIDC RP（含第三方库的 iss 校验）可直接接入；`getIssuer()`/`getTrustedOrigins()` 等 config 包推导函数复活。
- RT 重放爆炸半径收窄到单 client；管理端撤销真实生效。
- ~~过渡窗内新旧 token 并存，Gateway 验签双接受~~ 窗口已当日关闭：`LEGACY_ISSUER` 已从 `token.ts` / `jwks.rs` 删除，验签仅接受 URL issuer。
- `refresh_tokens` 体积随 client 数不变（RT 本就按授权签发），新增索引 `idx_refresh_tokens_client` 支撑按 client 撤销/列表查询。

## 相关 ADR

- ADR-004: 无状态 JWT + Redis jti 黑名单（"access_tokens 预留"条款废止）
- ADR-006: JWT 最小化（RBAC 数据剥离维持；OAuth 协议数据的分层见决策 4）
- ADR-011: 故障语义分级（introspect 的 jti 复核 fail-close）
- ADR-010: Gateway 统一 OAuth Client（SSO 会话 RT 的 client 恒为 `portal`）
