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
  - **2026-10-13 修订（架构评审 R2 次级候选「公开 URL 推导」）**：本条的"同源"要求此前**只实现了一半**——
    `getAppBaseURL()` 去尾斜杠，而 `getIssuer()` / `getJwksUri()` 对**显式配置**的值只 `.trim()`，
    于是 `PORTAL_ISSUER=https://sso.example.com/`（一个尾斜杠）会让 Discovery 声明
    `issuer: "https://sso.example.com/"`，而 RP 用 `https://sso.example.com` 取 metadata ⇒
    **严格的 OIDC RP 以 issuer 不匹配拒绝登录**（OIDC Discovery §4.3：issuer MUST be identical to
    用于取 metadata 的 URL）。该不对称当时被 `apps/portal/src/lib/env.test.ts` 写成了期望。
    现收成一个纯函数 `resolvePublicUrls(env)`（`packages/config/src/env.ts`），三个公开 URL 的判据
    统一为「先 trim、再去尾斜杠」，getter 成为它的缓存视图包装。详见
    `docs/solution/2026-10-13-public-url-derivation.md`。
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

## 验证（2026-10-16 补：活体核实，含两处自我修订）

| 断言 | 证据（file:line） | 判定 |
|---|---|---|
| 2026-10-13 修订的核心修法：三个公开 URL 的判据收成一个纯函数 | `packages/config/src/env.ts:135` = `export function resolvePublicUrls(env: PublicUrlEnv): PublicUrls` | 真 |
| **过渡窗当日关闭**：`LEGACY_ISSUER` 已从 Portal 与 Gateway 删除 | `apps/portal/src` + `apps/gateway/src` 全量 grep `LEGACY_ISSUER` ⇒ **0 命中** | 真（强证据：常量确已不存在） |
| RT 绑定发放 client：`client_id` **NOT NULL + FK → clients**，历史行回填 `'portal'` | `apps/portal/drizzle/0001_drop_ghost_access_tokens_bind_rt_client.sql:13`（`SET NOT NULL`）、`:14-16`（`ADD CONSTRAINT fk_refresh_tokens_client FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE`）、`:17`（建索引）、回填语句 `UPDATE refresh_tokens SET client_id = 'portal' WHERE client_id IS NULL` | 真 |

**旁证（顺带核实）**：同一迁移 `:11` 有 `DROP TABLE IF EXISTS access_tokens` —— 即它顺带删掉了
幽灵表 `access_tokens`，这正对应别处日志里的 `table "access_tokens" does not exist, skipping`
（表已按 ADR 删除、迁移日志仍提及，属正常现象，不是缺陷）。

## 增补（2026-10-23）：audience 策略、issuer 自洽与 typ 对齐（审计 D6 / H-05 / H-07 / H-A-04）

### 1. audience 策略：机器端点接受任意 client 的 AT，但归属与端点各自设防

**决策：`userinfo` / `introspect` 不按 `aud` 过滤（`verifyAccessToken(token, null, …)`），
这是 OIDC 语义下的显式选择；`revoke` 与 `introspect` 另以 `client_id` claim 做归属校验。**

| 端点 | audience 校验 | client 归属校验 | 理由 |
|---|---|---|---|
| `GET /api/auth/oauth2/userinfo` | 不校验（`null`） | 不做（凭 AT 本身） | OIDC Core 未要求 aud 限定；AT 是 Bearer 凭证，持有者即被授权方 |
| `POST /api/auth/oauth2/introspect` | 不校验（`null`） | **要求 `claims.client_id === 调用方 client`**（AT/RT 两分支） | RFC 7662 端点保护策略：不向无关 client 披露他 client 令牌元数据（H-07） |
| `POST /api/auth/oauth2/revoke` | 不校验（`null`） | **要求 `client_id` 归属**（AT 分支）/ RT 按 `(tokenHash, clientId)` 限定 | RFC 7009 防跨 client 撤销 DoS |

- 明确记录：不做"AT 只能被 aud 对应 client 使用"的限制，因为 userinfo/introspect 是**多 client
  通用端点**；若未来需要按 RS 隔离，应引入 RFC 8707 resource indicators 或 per-RS aud
  （ADR-013 演进路径），而不是在 userinfo 加白名单。
- 实现（现行行号）：`app/api/auth/oauth2/userinfo/route.ts`、`introspect/route.ts`、
  `revoke/route.ts` 的 `verifyAccessToken(..., null, JWT_TYP.ACCESS_TOKEN)` 调用与后续归属判断。

### 2. issuer 自洽：discovery 的网络位置 = Gateway 入口（与 ADR-010 更正是同一事实）

- `issuer` 必须等于 RP 取 metadata 的 URL；生产唯一入口是 Gateway，因此 discovery 中声明的
  四个机器端点也都在 Gateway 域名下。**Gateway 必须放行这些端点的客户端 `Authorization`**
  （Public 路径保留，见 ADR-010 更正）；否则"声明 endpoint 在 A、实际从 A 访问却被 401 剥离"
  自相矛盾。
- 该自洽性由 e2e `tests/e2e/oidc-machine-endpoints.spec.ts` 与
  `.zcode/audit/review/A-L01/repro.mjs` 的真实请求共同钉住。

### 3. typ 双端对齐（H-05）

- Gateway 自 ADR-013 起**强制** `typ=at+jwt`（缺失即拒，`apps/gateway/src/auth/verify.rs:129-133`）。
- Portal 身份边界（`lib/auth/token.ts` 的 `verifyAccessToken`）同步收紧：`expectedTyp` 传入时
  `header.typ` **必须存在且相等**，缺失即拒（2026-10-23 修复；此前"typ 缺失放行"的兼容窗与
  ADR-013 决策 2 矛盾）。
- 验证：`apps/portal/__tests__/api/session-lifecycle.test.ts:184` 起（typ 一致通过 / 类型冒充拒绝 /
  缺失拒绝）。

### 4. discovery 的 `token_endpoint_auth_methods_supported` 曾声明 `none`（D7，已闭合）

- 历史：`packages/contracts/src/oidc.ts` 的 `TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED` 曾含 `'none'`，
  而实现对所有 client 强制 secret（无 public client 支持）——声明与实现不符，会让 RP 误以为可免密换取令牌。
- 决策（D7）：删除 `'none'`，以"必须提供 client_secret（Basic 或 POST body）"为唯一对外契约。
- **闭合（2026-10-23）**：`packages/contracts/src/oidc.ts` 已删除 `'none'`；
  `apps/portal/__tests__/api/oidc-discovery.test.ts` 新增断言 `token_endpoint_auth_methods_supported`
  恰为 `['client_secret_basic','client_secret_post']` 且不含 `none`。若未来支持 public client，
  必须同时实现、加回该声明、更新本节与 ADR-024 的前置条件。
