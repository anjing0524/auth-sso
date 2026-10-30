# 子系统与第三方自研应用接入指南 (基于统一网关鉴权)

> 版本：v1.3 | 状态：正式发布 | 最后更新：2026-10-29（文档审计：路径引用改为「仓库相对路径 + 符号名」，清理重复引用）

本文档详细描述了企业内部自研子系统（或受信任的第三方应用）如何接入 Auth-SSO 统一门户，并实现极速、无痛的权限管理。

> **可验证性是本文的硬约束**：凡涉及**端口、路径、头名、Redis 键、命令**的断言，都在行内标注了代码出处
> （仓库相对路径 + 符号名；不写行号，见 `AGENTS.md`）。与代码冲突时以代码为准（`docs/README.md` §三），并回来改本文。
> 逐条验证步骤见 [`../INTEGRATION_GUIDE.md`](../INTEGRATION_GUIDE.md)。

## 1. 核心设计理念：边缘鉴权 + 全局缓存

基于我们现有的 Pingora 网关和 SSO Portal，我们采用**“统一网关边缘鉴权链路”**。在这种架构下，各个自研子系统被视为“保护伞下的哑服务”，它们**不需要实现任何登录 (login) 页面**，也**不需要实现 OIDC 回调 (callback) 接口**。

*   **唯一入口**：所有子系统的流量必须强制经过 Pingora 网关（生产拓扑只发布 Gateway 的 80/443，`docker/compose/prod.yml`；Portal 仅 `expose` 4000，`docker/compose/prod.yml`）。
*   **单点登录靠 OIDC + Portal 会话**：子系统与 Portal 位于同一父域（如 `*.company.com`）只是为了让**入口统一、跳转自然**；会话 Cookie 本身没有 `Domain` 属性（见阶段一第 4 条末尾），所以跨子系统「一次登录、处处通行」是靠「新主机 → 网关 302 authorize → Portal 仍是登录态直接签码」，而不是把会话 Cookie 广播到整个父域。
*   **零信任防伪造**：网关清洗外部伪造的身份 Header，只有经过验证的请求才会被注入真实的 `X-User-Id`（剥离与注入都在 `apps/gateway/src/gateway.rs` 的 `upstream_request_filter`）。
*   **全局缓存极速鉴权**：用户的极细粒度权限（Permissions）集中存放在 Redis 的 `portal:user_perms:{userId}`，由 **Portal 在 Token 签发时写入**、由**子应用自己读取**；**网关不读也不写这份缓存**（见 §2 阶段三与 §3 FAQ）。

---

## 2. 完美交互链路详述

### 阶段一：统一登录与全局 Token 签发 (Authentication)

1.  用户在未登录状态下访问子系统（例如财务系统：`finance.company.com`）。
2.  **Pingora 网关**拦截请求，发现缺少有效的 Token Cookie，**直接生成 PKCE + Set-Cookie → 302 重定向到 `/api/auth/oauth2/authorize`**，启动标准 OAuth 2.1 授权码流程
    （`apps/gateway/src/gateway.rs` → `apps/gateway/src/oauth_flow.rs`：构造
    `/api/auth/oauth2/authorize?response_type=code&client_id=…&code_challenge=…&state=…&nonce=…`，
    同时下发 `pkce_verifier` / `oauth_state` / `oauth_nonce` / `return_to` 四个临时 Cookie，`apps/gateway/src/oauth.rs`）。
3.  用户在 SSO Portal 的登录页面成功验证账号密码。
4.  **Gateway 完成 callback 与 Token 交换**：浏览器带着 code 回到 Gateway 的 callback 路径，Gateway 在内网向
    Portal `POST /api/auth/oauth2/token` 换取 token，再 `Set-Cookie: portal_jwt_token` + `portal_refresh_token`
    并 302 回 `return_to`（交换与下发 Cookie 在 `apps/gateway/src/oauth_flow.rs`、`apps/gateway/src/oauth.rs`；
    Cookie 名定义在 `apps/gateway/src/cookie.rs`）。
5.  **Portal 在签发时预填充权限缓存**（两处签发路径共用同一个函数）：
    *   **组装权限**：级联查询数据库，收集用户所属 ACTIVE 角色的全部 `permissions` 字符串、`roles`
        与 `deptIds`（**`deptIds` 是角色 `dept_id` 原始值，未展开子树**，见 INFO 框）；
    *   **写入 Redis**：`SETEX portal:user_perms:{userId}` = `{ roles, permissions, deptIds }`，
        TTL = 3600s ±300s 随机抖动（键前缀 `packages/contracts/src/oidc.ts`；写入
        `apps/portal/src/lib/permissions.ts` 的 `PERM_CACHE_TTL_BASE` / `PERM_CACHE_TTL_JITTER`）；
    *   **签发 Token**：AT 只含身份断言（`sub` / `jti` / 协议 claims），**不含** `roles` / `permissions` / `deptIds`
        （ADR-006；`apps/portal/src/lib/auth/token.ts` 的 payload 即证（`{ sub, client_id, ...(scope) }`））。
    *   预填充是**尽力而为**：DB 故障时照常签发但跳过预填充（`apps/portal/src/lib/permissions.ts` 的
        `resolveIssuancePermission`，语义见 ADR-011 / ADR-018）。⇒ **`portal:user_perms:*` 不保证存在**。
    *   **Cookie Domain 由浏览器侧的 Host 决定**：Gateway 构造 `Set-Cookie` 时只写
        `Path=/; HttpOnly; SameSite=Lax; Max-Age=…; Secure`，**没有** `Domain=` 属性
        （`apps/gateway/src/oauth.rs`），因此会话 Cookie 只对**登录时的那个主机名**生效。
        跨子系统共享登录态靠的是**同一浏览器在该主机上仍持有有效会话**（再次访问新主机 → 网关 302 authorize →
        Portal 已是登录态则直接签码，无需再输密码），而不是靠 `.company.com` 泛域名 Cookie。

> **INFO — 登录会话绑定（ADR-023）**：登录页的 OAuth 回跳只在浏览器持有该授权请求的
> 一次性 HttpOnly 绑定 Cookie 时发生。用第三方链接把受害者登录导向攻击者发起的
> client/redirect（授权请求注入）会被拒绝，并以普通登录处理（不回跳 OAuth）。

> **INFO — `deptIds` 未展开子树（ADR-002 增补 / 决策 D1）**：缓存值 = 用户所有 ACTIVE 角色的
> `roles.dept_id`（原始值）。子应用若要做部门数据范围，必须自行按 `departments.ancestors`
> 展开子树，或调用 Portal 授权接口；不能直接把它当作"可见部门集合"（会漏子部门数据，fail-closed）。


### 阶段二：无感穿越网关 (Gateway Routing)

1.  浏览器再次请求 `finance.company.com`，自动携带上一步种下的会话 Cookie（`portal_jwt_token` / `portal_refresh_token`）。
2.  **Pingora 网关**拦截请求，执行纯离线密码学验签（基于 JWKS 缓存，`apps/gateway/src/jwks.rs` 后台定时 + UnknownKid 按需刷新）+ jti 黑名单检查。
3.  **请求净化与洗头**（`apps/gateway/src/gateway.rs` 的 `upstream_request_filter`）：
    *   先剥离所有「身份相关」头：`Authorization`、`Forwarded`、`Proxy-Authorization`，以及除白名单外的全部 `X-*`
        头（黑名单兜底，`apps/gateway/src/gateway.rs` 的 `strip_identity_headers`）；**入站自带**的 `X-User-Id` 因此一律被清掉。
    *   Cookie 按路径分类重写（`apps/gateway/src/gateway.rs`）：`PathClass::Microservice`（`/api/v1/**`，排除 `/api/v1/auth/**`）
        **移除全部 Cookie**；`PathClass::Protected` **剥离 RT 并替换 AT**（若本次静默续签过）；Static/Public 原样透传。
    *   验签通过后**重新注入**（`apps/gateway/src/gateway.rs`）：`Authorization: Bearer {AT}`、`X-User-Id: {sub}`、
        `X-User-Jti: {jti}`（头名常量 `apps/gateway/src/gateway.rs`，Portal 侧同名常量 `packages/contracts/src/index.ts`）；
        配置了 `gateway_shared_secret` 时再加 `X-Gateway-Timestamp` + `X-Gateway-Signature`（HMAC-SHA256）。
4.  网关将洗净后的纯净请求转发给内网子系统（按 `[[upstreams]]` 的 `name` 前缀做最长前缀匹配，`apps/gateway/src/router.rs`）。

> **Exception — Public 路径（2026-10-23 更正，ADR-010 更正段）**：白名单 Public 路径
> （`/api/auth/*`、`/.well-known/*` 等）**不执行上述剥离/注入**，而是把客户端自带的
> `Authorization` 原样转发，并且**不注入** `X-User-Id`/`X-User-Jti`/`X-Gateway-*`。
> 原因：Gateway 是 discovery/issuer 的网络位置，标准 OIDC 客户端（Basic）与 userinfo（Bearer）
> 必须经唯一入口工作；Portal 对这些 Bearer 自验签并复核 jti 黑名单，撤销语义不降级。
> 因此"网关移除 Authorization"这句话的准确范围是**受保护/微服务路径**，不是全部流量。


### 阶段三：子系统极速鉴权 (Authorization)

子系统收到请求后，完全不知道该用户是如何登录的，也无需维护任何登录会话。

*   **后端接口鉴权**：
    *   微服务从 Header 提取 `X-User-Id`（无则视为未认证 → 401）。
    *   拦截器在执行真正的业务逻辑前，向同内网的 **Redis** 发起一次 `GET portal:user_perms:{userId}`
        （仓库内参考实现：`apps/demo-app/src/lib/permissions.ts`；demo 在缓存缺失时的展示分支见 `apps/demo-app/src/app/page.tsx`）。
    *   代码层仅进行字符串校验，如 `@RequirePermission("order:delete")`，通过即放行，拒绝则抛出 HTTP 403。
    *   **缓存未命中必须按 deny/降级处理**，不能当作"有身份就有权限"：它可能因为「DB 故障跳过预填充」而缺失（§2 阶段一），
        也可能已过 TTL 自然过期。
*   **前端菜单动态渲染**：
    *   子系统前端初始化时调用 Portal 的 `/api/me`（返回 `user` / `permissions` / `roles` / `deptIds` / `menus` 菜单树，
        `apps/portal/src/app/api/me/route.ts`）或 `/api/me/permissions`（只返回 `userId` / `roles` / `permissions` / `deptIds`，
        `apps/portal/src/app/api/me/permissions/route.ts`）。
    *   **这两个端点在 Gateway 配置里都没有列进 `public_paths`**（`apps/gateway/gateway.e2e.toml`、
        `apps/gateway/gateway.docker.toml`、`apps/gateway/gateway.toml`），所以经网关访问它们要求有效会话；它们也**不是**跨域公开 API。
    *   Portal 不提供独立的 `/sso/my-menus` REST 端点（全仓无此路径）。

---

## 3. 常见问题答疑 (FAQ)

**Q：为什么签发 Token 的时候不需要根据 Client (子系统) 过滤专属权限？**
A：因为我们颁发的 Token 只是**“身份凭证” (Identity)**——AT 的 payload 只有 `sub` / `client_id` / `scope` 等协议与身份字段，**不含**权限数组（`apps/portal/src/lib/auth/token.ts`，ADR-006）；而具体的权限数据 (Permissions) 全部存在 Redis 全局缓存 `portal:user_perms:{userId}` 里。子系统（如财务服务）查 Redis 时只关心“这个用户有没有 `order:delete` 这个词”。注意权限码是 `{clientId}:` 前缀自描述的（ADR-008），所以“不过滤”并不会把别的子系统的权限误当成自己的——**但前提是你按完整权限码比较**，而不是按末段字符串匹配。

**Q：`portal:user_perms:*` 是谁写的？网关会帮我预热吗？**
A：**不会**。写缓存的是 Portal（`apps/portal/src/lib/permissions.ts`，调用点 `apps/portal/src/lib/auth/oauth-grant.ts` 与 `apps/portal/src/lib/auth/token.ts`），网关只注入 `X-User-Id` / `X-User-Jti` / `Authorization`（`apps/gateway/src/gateway.rs`），全仓 `apps/gateway/src` 无任何 `user_perms` 代码（ADR-007：网关不做权限）。而且**预填充是尽力而为**：DB 故障时 Portal 照常签发但跳过写入（`apps/portal/src/lib/permissions.ts`），TTL 到期后也要等下一次签发才会回填。⇒ 子应用必须处理“缓存不存在”。

**Q：外部采购的 SaaS 软件（无法修改代码）怎么接入？**
A：本方案主要针对“自研”或“深度定制”的子系统。如果是纯黑盒第三方系统（如 Jira），其无法读取 Redis 且要求拥有自己的登录闭环。此类系统需退化为标准的 OIDC 协议链路：在 SSO Portal 中作为独立的 OAuth Client 接入，经 Gateway 唯一入口访问 OIDC 端点（`userinfo_endpoint` = `<入口>/api/auth/oauth2/userinfo`，`apps/portal/src/app/.well-known/openid-configuration/route.ts`），由其拉取基础属性映射其内部权限。

## 4. 接入开发规约 (针对子系统研发)

1.  **禁止私自管理角色**：子系统不允许建立独立的“角色表”和“用户角色关联表”。
2.  **基于 Permission 编程**：后端拦截器必须校验具体的权限编码（如 `sys:user:edit`），**禁止校验角色名**（如 `admin`），以保证组织架构调整时业务代码无需修改。
3.  **零 Token 接触**：子系统不要尝试读取和校验 JWT，统一信任网关塞入的 `X-User-Id`（同请求还有 `X-User-Jti`，仅供日志/审计关联，不要当鉴权依据）。
4.  **缓存未命中按 deny 处理**：Redis 里查不到 `portal:user_perms:{userId}` 时不得放行（它是 fail-closed 的数据源，见 §2 阶段三）。
5.  **不要在子应用侧校验 `X-Gateway-Signature`**：那是 Gateway→Portal 这一跳的 HMAC（`apps/gateway/src/gateway.rs`，校验方 `apps/portal/src/lib/auth/verify-jwt.ts`），子应用不持有共享密钥、也不在信任链上；子应用能信任身份的前提是**端口只对 Gateway 开放**（拓扑约束，见 §1 唯一入口）。
