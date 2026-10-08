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

## 相关 ADR

- ADR-003: Gateway 作为统一 OAuth Client（本 ADR 消除其"单数"表述与配置面的矛盾）
- ADR-006 / 007 / 008: client 身份在授权链路中无消费者的依据
