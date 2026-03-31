# 小企业统一门户 + SSO + 权限中心冻结评审版总方案

- 版本：`v1.0`
- 状态：`冻结评审版`
- 目标：统一需求、架构、技术选型、数据边界、研发实施口径

---

## 1. 一句话定义

这是一个由 `Portal`、`IdP`、`RBAC 权限中心` 组成的统一门户系统：

- `Portal` 管“你在门户是否登录，能看什么，能做什么”
- `IdP` 管“你在整个系统是否登录”
- `Token` 管“你能访问什么受保护资源”

---

## 2. 系统组成

## 2.1 应用划分

- `apps/portal`：`Next.js` 门户与管理后台应用，承担 `BFF`
- `apps/idp`：`Next.js + Better Auth` 独立认证应用，承担登录页、认证确认页、错误页、OIDC API、SSO

## 2.2 系统角色

- `Browser`：只负责跳转、Cookie 携带、接收回调参数
- `Portal`：OIDC Client、门户登录态、权限中心、管理后台
- `IdP`：认证中心、OIDC、授权码与 Token 运行态、IdP Session
- `子应用`：独立 OIDC Client，通过 IdP 接入 SSO

---

## 3. 固定技术选型

- `Portal`：`Next.js 16 + App Router + Route Handlers`
- `IdP`：`Next.js 16 + Better Auth + App Router + Route Handlers`
- `UI`：`shadcn/ui`
- `CSS`：`tailwindcss@latest`
- `语言`：`TypeScript`
- `校验`：`Zod`
- `数据库`：`PostgreSQL 16`
- `ORM / SQL Builder`：`Drizzle ORM`
- `会话`：`Redis`

初始化要求：

- `apps/portal` 和 `apps/idp` 都必须用官方最新交互式 `create-next-app` 初始化

---

## 4. 核心边界

### 4.1 Session 边界

- `Portal Session`：表示用户在 Portal 是否登录
- `IdP Session`：表示用户在整个认证中心是否登录
- `Portal Session != IdP Session != Token`

### 4.2 登出边界

v1.0 登出定义：

- 删除 `Portal Session`
- 删除对应 `IdP Session`
- 用户之后再次访问 Portal 或重新发起 OIDC 流程时，必须重新登录

### 4.3 用户与组织边界

- v1.0 用户只有一个主部门
- 用户可拥有多个角色
- 数据范围通过角色控制，不通过多部门归属表达

---

## 5. Better Auth 架构定位

`apps/idp` 不是纯后端服务，而是独立认证 Web 应用：

- 承载登录页
- 承载认证确认页
- 承载错误页
- 承载 `/authorize`、`/token`、`/userinfo`、`/jwks`
- 管理授权码、Token 运行态、IdP Session

`apps/idp` 不负责：

- 不负责 Portal RBAC 管理后台
- 不负责部门、角色、菜单管理
- 不负责 Portal Session

### 5.1 Better Auth 插件冻结选择

v1.0 计划启用：

- Better Auth 核心认证能力
- `emailAndPassword`
- `@better-auth/oauth-provider`
- `jwt`

说明：

- 官方 `OIDC Provider` 插件已标注将被 `OAuth Provider` 取代
- 因此本项目不以旧 `OIDC Provider` 作为 v1.0 主方案
- 本项目通过 `OAuth Provider + openid scope + jwt` 提供 OIDC 兼容能力与 `jwks`

### 5.2 Better Auth 启用能力清单

v1.0 明确启用：

- 用户名密码登录
- IdP Session 管理
- OAuth 2.1 Provider
- 基于 `openid` scope 的 OIDC 兼容能力
- 授权码模式
- PKCE
- Access Token / Refresh Token
- `jwks`
- 密码重置能力

v1.0 明确不启用：

- `organization`
- `twoFactor`
- `passkey`
- `magicLink`
- `emailOtp`
- `phoneNumber`
- `admin`
- `apiKey`
- 第三方社交登录
- 独立账号中心

说明：

- 以上“不启用”项不是技术上不可做，而是本版本范围冻结后不纳入实施
- 后续如启用新插件，必须重新执行 Better Auth 官方 schema 生成并补充评审

### 5.3 Client 消费模式

v1.0 冻结选择：

- `apps/idp` 直接读取 `portal_core.clients`
- 不做异步复制
- 不做双写
- 不做延迟同步

说明：

- 这样可以避免 v1.0 引入配置同步链路复杂度
- `Client` 配置由 Portal 管理，IdP 只读消费

### 5.4 用户与认证身份联动规则

v1.0 冻结规则：

- Portal 创建用户时，必须同步创建认证身份映射
- 用户禁用后，IdP 必须立即拒绝新的登录与授权
- 重置密码由 Portal 发起，由 IdP / Better Auth 执行并落认证域
- 删除用户默认不做物理删除，采用禁用或逻辑删除

### 5.5 IdP 页面范围

v1.0 `apps/idp` 页面范围仅包括：

- 登录页
- 认证确认页
- 错误页

v1.0 不包含：

- 用户管理后台
- 独立账号中心
- 忘记密码独立产品化流程
- MFA 管理页
- 第三方身份源管理页

---

## 6. 页面冻结清单

### 6.1 `apps/portal` 必有页面

- 登录态校验入口页
- 首页工作台
- 应用导航页
- 用户管理页
- 部门管理页
- 角色管理页
- 权限管理页
- Client 管理页
- 登录审计页
- 操作审计页
- 无权限提示页

### 6.2 `apps/portal` 可选页面

- 用户中心
- Session 失效统一提示页

### 6.3 `apps/portal` v1.0 不做

- 独立账号中心
- MFA 设置页
- 第三方身份绑定页
- 子应用业务页面

### 6.4 `apps/idp` 必有页面

- 登录页
- 认证确认页
- 错误页

### 6.5 `apps/idp` 可选页面

- 简单密码重置页

说明：

- 若密码重置采用邮件跳转页承载，可放在 `apps/idp`
- 若采用后台发起后直接完成重置，可不单独建设完整页面流程

### 6.6 `apps/idp` v1.0 不做

- 用户管理后台
- 独立账号中心
- MFA 管理页
- 社交登录配置页
- 第三方身份源管理页

---

## 7. 最终数据落位

说明：

- 接口层暴露的 ID 为字符串 `public_id`
- 数据库内部关系连接使用 `bigint id`
- 不使用外部字符串 ID 做数据库物理外键

## 7.1 PostgreSQL

### `portal_core`

存业务主数据：

- `users`
- `user_identities`
- `departments`
- `roles`
- `permissions`
- `menus`
- `clients`
- `client_redirect_uris`
- `client_scopes`
- `client_grant_types`
- `client_secret_histories`
- `user_role_rel`
- `role_permission_rel`
- `role_department_rel`
- `role_menu_rel`
- `audit_logs`
- `login_logs`

### `idp_auth`

存 Better Auth 认证持久化数据：

- Better Auth 核心表：
  - `user`
  - `session`
  - `account`
  - `verification`
- Better Auth 插件扩展表：
  - 按当前 v1.0 计划，追加 `oauthClient / oauthRefreshToken / oauthAccessToken / oauthConsent / jwks`
- 与认证相关的持久化运行态：
  - 认证账号与认证凭证
  - 授权码
  - Access Token / Refresh Token 运行态
  - 验证码、重置密码、认证临时数据

说明：

- `idp_auth` 基础物理表至少包含 Better Auth 核心 4 表：`user / session / account / verification`
- 插件表按实际启用插件追加
- 最终物理表结构必须以当前 Better Auth 配置执行官方生成命令后的结果为准
- 不在业务文档里伪造 Better Auth 内部表字段

## 7.2 Redis

### `portal:*`

- `portal:sess:{sessionId}`：Portal Session
- `portal:user:sessions:{userId}`：用户活跃 Portal Session 索引
- `portal:auth:txn:{state}`：Portal 登录临时认证上下文，保存 `state / nonce / code_verifier / redirect`

### `idp:*`

- `idp:sess:{sessionId}`：IdP Session

## 7.3 不允许的落位

- Token 不落浏览器 `localStorage`
- Portal Session 不落 PostgreSQL 主表
- IdP Session 不落 PostgreSQL 主表
- 不把业务主数据混入 Better Auth 内部认证表

---

## 8. 登录链路与数据流

## 8.1 Portal 登录

1. `Portal` 创建 `portal:auth:txn:{state}`
2. 浏览器跳转 `IdP /authorize`
3. `IdP` 完成认证
4. `Portal /callback` 用 `code` 换 Token
5. `Portal` 建立 `portal:sess:{sessionId}`
6. `Portal` 写入 `portal:user:sessions:{userId}`

## 8.2 子应用 SSO

1. 子应用跳转 `IdP /authorize`
2. 浏览器自动携带 `idp_session`
3. `IdP` 检查 `idp:sess:{sessionId}`
4. 若有效，继续授权码流程

## 8.3 登出

1. 删除 `portal:sess:{sessionId}`
2. 更新 `portal:user:sessions:{userId}`
3. 删除 `idp:sess:{sessionId}`
4. 后续访问必须重新登录

---

## 9. v1.0 最终结论

v1.0 的落地核心不是“做一个登录页”，而是建立三层稳定边界：

- `Portal`：业务主数据与门户登录态
- `IdP`：认证运行态与全局 SSO
- `PostgreSQL + Redis`：按职责清晰落位
- `Client`：Portal 管理，IdP 直连只读消费
- `用户与认证身份`：创建、禁用、重置密码必须联动

只要这三层不混，需求、设计、接口、数据库和实现就能保持一致。
