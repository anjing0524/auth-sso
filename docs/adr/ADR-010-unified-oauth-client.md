# ADR-010: Gateway 统一 OAuth Client —— 废止 per-upstream 独立凭据

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | implemented (2026-09-28，一期止血与二期配置面收敛当日全部完成) |
| **日期**   | 2026-09-28                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | Gateway 配置面（`[[upstreams]].oauth`）、Portal clients 表、第三方子应用接入 |

## 背景

`[[upstreams]]` 允许每个 upstream 配置独立的 `oauth.client_id/client_secret`，而 callback 拦截路径是全局单一的（来自 OIDC Discovery `com_authsso_callback_path`）。`/authorize` 阶段用**被访问路由**的凭据发起 PKCE（`gateway.rs` `oauth_authorize_redirect`），callback 阶段却用 **callback 路由解析出的凭据**换 token（`handle_oauth_callback`），四个临时 Cookie 均不携带 client_id —— 任何非 callback 路由的 upstream 配置了不同凭据时，其授权码在 callback 处必然 `invalid_grant`。这是结构性缺陷，不是配置错误。

更深层地：**per-upstream client 身份在本架构中没有消费者**。

- RBAC v3.2 已删除 `role_clients` 表（ADR-002），AS 侧的 client 身份不参与授权链路；
- AT 经 ADR-006 最小化后无 client/scope 语义（aud 为体系级）；
- 权限码用 `{clientId}:` 前缀自描述（ADR-008），子应用自取权限（ADR-007）。

业界两种成熟形状都不存在"per-client 配置 + 全局共享 callback"这一杂交：

1. **网关级单 Client**：Envoy OAuth2 filter、nginx auth_request/oauth2-proxy 的通用形态；
2. **per-route Client + per-route callback**：Kong `openid-connect` 插件，每个 route 作用域实例自带 `client_id/redirect_uri` 并拦截**自己的** callback。

## 决策

**采用形状 1：Gateway 是网关级统一 OAuth Client。**

- ~~一期（已实现）~~：~~`validate_routing_consistency` 强制所有 upstream 的 OAuth 凭据一致~~ 已被二期取代——per-upstream 凭据造型整体删除，不一致在结构上不再可能。
- **二期（已实现）**：oauth 配置从 `[[upstreams]]` 上移到 `[gateway.oauth]`（`GatewayConfig.oauth`），`UpstreamConfig` 仅保留 `oauth_enabled: bool`（默认 true）；`RouteEntry` 不再携带 OAuth 配置，`Router` 回归纯前缀路由表。
- 若未来出现真实的"多租户各自 secret"需求，演进到形状 2（per-route callback + 各自 redirect_uri 注册），**不经过**"client_id 随 state Cookie 携带"的缝合方案（新增跨阶段状态与伪造校验面，只为不存在的需求付费）。

## 后果

- AS（Portal）审计按网关粒度归因；目标子应用信息可从 `return_to` 打入审计日志补偿。
- secret 轮换只操作一处配置 + Portal `portal` client 一行记录。
- 第三方子应用"零 OAuth 代码接入"承诺不变（ADR-003）；需要独立 client 身份的 RP 走标准 OIDC 直连 Portal（与 Gateway 无关）。

## 更正（2026-10-23，erratum）：OIDC 拓扑 —— Gateway 是 discovery/issuer 的网络位置，必须让机器端点可用

**本文「后果」段原写"需要独立 client 身份的 RP 走标准 OIDC 直连 Portal（与 Gateway 无关）"，
该表述与部署拓扑矛盾，现更正如下（安全审计 H-D-01 / 跨线 L-01，复核 D3）：**

- **issuer 与 discovery 的网络位置就是 Gateway 入口**：`/.well-known/openid-configuration`
  由 Portal 生成，但经 Gateway 转发；`issuer = NEXT_PUBLIC_APP_URL`（部署入口 URL），且
  discovery 里的 `token_endpoint`/`userinfo_endpoint`/`introspection_endpoint`/
  `revocation_endpoint` 全部指向该入口（2026-10-23 实测：四个 endpoint 均以
  `https://<入口主机>` 开头）。ADR-012 要求 issuer 与取 metadata 的 URL 同源——因此
  **标准 OIDC RP 必然经 Gateway 访问这些机器端点**。
- **生产环境"直连 Portal"物理不可达**：`docker/compose/prod.yml` 只发布 Gateway 的 80/443，
  Portal 无宿主端口（仅 Compose 内网）；测试栈的"直连"仅用于容器内探针。
- **因此 Gateway 必须让机器端点携带的客户端凭证到达 Portal**：`Authorization` 头在
  **Public 路径**（`/api/auth/*`、`/.well-known/*` 等白名单）按客户端原样转发；在
  Protected/Microservice/Static 路径继续执行"剥离客户端身份头 → 按验签结果权威注入"。
  实现：`apps/gateway/src/gateway.rs:202`（`strip_identity_headers(req, path_class)`）、
  `:204`（`keep_authorization = path_class == PathClass::Public`）、`:631`（Public 直接放行）；
  反向保证：Public 路径**不注入** `X-User-Id`/`X-User-Jti`/`X-Gateway-*`，Portal 对
  Bearer 走自验签（含 jti 黑名单 fail-close），撤销语义不降级。
- **实施顺序注意**：该更正依赖 Gateway 已修复"无条件剥离 Authorization"（H-D-01）；
  未运行新镜像的部署仍表现为标准 Basic 客户端 401。
- 第三方子应用接入方式不变（ADR-003/010 的 Gateway 统一 OAuth Client）；黑盒 SaaS 走
  标准 OIDC 时，其所有请求也经该唯一入口，而不是另开 Portal 端口——若未来确需独立入口，
  应新增明确的部署拓扑与白名单决策，而不是由本文一句"直连"隐含。

**验证**：`tests/e2e/oidc-machine-endpoints.spec.ts`（Basic 假 code → 400 invalid_grant、
Bearer userinfo → 200、Protected 伪造 Bearer 仍 401）；审计证据
`.zcode/audit/review/A-L01/repro.mjs` + `result.json`、`.zcode/audit/gateway/18-p1-authorization-strip.txt`。

## 相关 ADR

- ADR-003: Gateway 作为统一 OAuth Client（本 ADR 消除其"单数"表述与配置面的矛盾）
- ADR-006 / 007 / 008: client 身份在授权链路中无消费者的依据
- ADR-012: issuer/discovery 同源要求（本更正与其自洽）
- ADR-023: 登录会话绑定（登录链路的另一端）

## 验证（2026-10-16 补：活体核实）

| 断言 | 证据（file:line） | 判定 |
|---|---|---|
| 二期：oauth 配置从 `[[upstreams]]` 上移到 `[gateway.oauth]`（`GatewayConfig.oauth`） | `apps/gateway/src/config.rs:93` = `pub oauth: OAuthConfig` | 真 |
| 二期：`RouteEntry` 不再携带 OAuth 配置 | `RouteEntry` 结构体定义内 grep `oauth` **零命中** | 真 |
| 一期：per-upstream 凭据**一致**校验已被取代 | `config.rs:188-198` 的 `validate_routing_consistency` 改为校验**单一** `[gateway.oauth]` 凭据非空、**缺失即拒绝启动**（`:192` 注释即"ADR-010 二期：凭据已收敛到 `[gateway.oauth]`"），**不再比较 per-upstream 一致性** | 真 |
| （顺带）路由卫生校验仍在，职责清晰 | 同函数 `:201-209`：upstream 名重复 / 空名 / **防止某个 upstream 为别的 upstream 的路径开免鉴权后门** | 在位 |

**一处"看似矛盾、读实不成立"的记录**（核实方法上的提醒）：本文用删除线标注一期方案被二期取代，
而全仓 grep `validate_routing_consistency` 仍有 **15 处命中** —— 初看像是"删除线不实"。
读实后不成立：函数**仍在**，但它做的是"校验单一凭据 + 路由卫生"，**不再是**比较 per-upstream 凭据；
15 处命中只是函数名出现在定义 / 调用点 / 测试里。⇒ 判断历史决策是否被取代，要看**函数现在做什么**，
而不是看它**是否还存在**。
