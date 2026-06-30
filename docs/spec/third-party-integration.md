# 子系统与第三方自研应用接入指南 (基于统一网关鉴权)

本文档详细描述了企业内部自研子系统（或受信任的第三方应用）如何接入 Auth-SSO 统一门户，并实现极速、无痛的权限管理。

## 1. 核心设计理念：边缘鉴权 + 全局缓存

基于我们现有的 Pingora 网关和 SSO Portal，我们采用**“统一网关边缘鉴权链路”**。在这种架构下，各个自研子系统被视为“保护伞下的哑服务”，它们**不需要实现任何登录 (login) 页面**，也**不需要实现 OIDC 回调 (callback) 接口**。

*   **唯一入口**：所有子系统的流量必须强制经过 Pingora 网关。
*   **泛域名共享**：所有子系统与 SSO Portal 共享顶级域名（如 `*.company.com`），依赖全局 Cookie 实现真正的 Single Sign-On（一次登录，处处通行）。
*   **零信任防伪造**：网关清洗外部伪造的身份 Header，只有经过验证的请求才会被注入真实的 `X-User-Id`。
*   **全局缓存极速鉴权**：用户的极细粒度权限（Permissions）在 SSO Portal 登录时已全量预热至 Redis 中。

---

## 2. 完美交互链路详述

### 阶段一：统一登录与全局 Token 签发 (Authentication)

1.  用户在未登录状态下访问子系统（例如财务系统：`finance.company.com`）。
2.  **Pingora 网关**拦截请求，发现缺少有效的 Token Cookie，立刻返回 `302 Redirect`，引导用户前往 `sso.company.com/login` 统一登录页。
3.  用户在 SSO Portal 成功验证账号密码。
4.  **SSO 服务端**执行关键操作：
    *   **组装权限**：级联查询数据库，收集该用户所属角色的全部 `permissions` 字符串和 `deptIds`。
    *   **写入 Redis**：将包含具体权限的 `UserPermissionContext` 全量压入 Redis（Key: `sso:user_perms:{userId}`，TTL 与 Token 对齐）。
    *   **签发 Token**：签发一个基础 JWT（仅需包含 `userId` 等最基础身份信息，避免 Header 膨胀）。
    *   **种下 Cookie**：将 JWT 写入浏览器 Cookie，并将 Domain 设置为顶级泛域名（`Domain=.company.com`）。
5.  SSO Portal 将页面重定向回刚才的业务地址 `finance.company.com`。

### 阶段二：无感穿越网关 (Gateway Routing)

1.  浏览器再次请求 `finance.company.com`，自动携带上一步种下的泛域名 Cookie。
2.  **Pingora 网关**拦截请求，执行纯离线密码学验签（基于预加载的 JWKS 缓存）。
3.  **请求净化与洗头**：
    *   网关强力移除外部传入的 `Authorization`, `X-User-Id` 等字段，防止伪造。
    *   将包含 JWT 的 Cookie 从请求头中剥离，防止内部系统触碰敏感 Token（`PathClass::Microservice` 策略）。
    *   从验签通过的 JWT 中提取用户身份，重新注入到 HTTP Header：`X-User-Id: {userId}`。
4.  网关将洗净后的纯净请求转发给内网的财务微服务。

### 阶段三：子系统极速鉴权 (Authorization)

财务微服务收到请求后，完全不知道该用户是如何登录的，也无需维护任何登录会话。

*   **后端接口鉴权**：
    *   微服务从 Header 提取 `X-User-Id`。
    *   拦截器在执行真正的业务逻辑前，向同内网的 **Redis** 发起极轻量查询，获取该用户的权限字典。
    *   代码层仅进行字符串校验，如 `@RequirePermission("order:delete")`，通过即放行，拒绝则抛出 HTTP 403。
*   **前端菜单动态渲染**：
    *   财务系统前端 SPA 在初始化时，携带全局 Cookie 调用 SSO Portal 的开放 API：`GET api.company.com/sso/my-menus?sys=finance`。
    *   SSO Portal 返回专属财务系统的菜单结构，前端基于此动态注册路由与按钮显示。

---

## 3. 常见问题答疑 (FAQ)

**Q：为什么签发 Token 的时候不需要根据 Client (子系统) 过滤专属权限？**
A：因为我们颁发的 Token 只是**“身份凭证” (Identity)**，而具体的权限数据 (Permissions) 全部平铺存储在 Redis 全局缓存中。子系统（如财务服务）在查询 Redis 时，只关心“这个用户有没有 `order:delete` 这个词”，至于 Redis 集合里是不是还混杂了 OA 系统的权限词汇，财务服务根本不关心。这就是极佳的**自然过滤机制**，避免了多套 Token 的重复签发问题。

**Q：外部采购的 SaaS 软件（无法修改代码）怎么接入？**
A：本方案主要针对“自研”或“深度定制”的子系统。如果是纯黑盒第三方系统（如 Jira），其无法读取 Redis 且要求拥有自己的登录闭环。此类系统需退化为标准的 OIDC 协议链路：在 SSO Portal 中作为独立的 OAuth Client 接入，由 SSO 提供 /userinfo 接口供其拉取基础属性映射其内部权限。

## 4. 接入开发规约 (针对子系统研发)

1.  **禁止私自管理角色**：子系统不允许建立独立的“角色表”和“用户角色关联表”。
2.  **基于 Permission 编程**：后端拦截器必须校验具体的权限编码（如 `sys:user:edit`），**禁止校验角色名**（如 `admin`），以保证组织架构调整时业务代码无需修改。
3.  **零 Token 接触**：子系统不要尝试读取和校验 JWT，统一信任网关塞入的 `X-User-Id`。
