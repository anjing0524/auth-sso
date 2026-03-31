# 小企业统一门户 + SSO + 权限中心 PRD / 技术方案

- 文档版本：`v1.0`
- 文档状态：`初版`
- 目标读者：产品、后端、前端、架构、安全、测试、运维
- 技术方向：`Better Auth（IdP） + Next.js Portal（BFF） + RBAC`

---

## 索引

- [1. 文档目标](#1-文档目标)
- [2. 产品目标](#2-产品目标)
- [3. 系统范围与边界](#3-系统范围与边界)
- [4. 用户与角色](#4-用户与角色)
- [5. 核心概念模型](#5-核心概念模型)
- [6. 总体架构](#6-总体架构)
- [7. 认证与登录流程](#7-认证与登录流程)
- [8. SSO 设计](#8-sso-设计)
- [9. Session 体系设计](#9-session-体系设计)
- [10. Token 管理](#10-token-管理)
- [11. IdP Session 设计](#11-idp-session-设计)
- [12. 权限中心设计](#12-权限中心设计)
- [13. 数据模型设计](#13-数据模型设计)
- [14. 管理功能需求](#14-管理功能需求)
- [15. 接口设计](#15-接口设计)
- [16. 子应用接入方案](#16-子应用接入方案)
- [17. 安全设计](#17-安全设计)
- [18. 非功能需求](#18-非功能需求)
- [19. 页面与交互建议](#19-页面与交互建议)
- [20. 版本范围](#20-版本范围)
- [21. 风险与注意事项](#21-风险与注意事项)
- [22. 最终设计原则](#22-最终设计原则)
- [23. 最终总结](#23-最终总结)

---

## 1. 文档目标

本文档用于定义一个面向中小企业的统一门户系统，覆盖统一登录、单点登录、权限中心、应用接入与安全会话体系。文档既作为产品需求基线，也作为研发落地方案的共同约束。

本文档重点解决以下问题：

- 企业用户只登录一次即可访问多个内部系统
- Portal 统一承接前端访问、登录态管理和权限展示
- IdP 统一承接认证、授权与 SSO 判断
- 权限中心统一管理用户、部门、角色、权限与应用
- 会话、Token、Cookie 职责清晰分离，避免前端越权和安全风险

---

## 2. 产品目标

### 2.1 核心目标

构建一个统一门户系统，实现：

- 单点登录（SSO）
- 统一认证（OIDC / OAuth 2.0）
- 多子应用接入
- 用户 / 部门 / 角色 / 权限管理
- 应用（OAuth Client）管理
- 安全可控的 Session 体系

### 2.2 业务价值

- 降低多系统重复登录成本
- 统一账号、权限与组织管理
- 降低各业务系统重复建设认证能力的成本
- 提高账号安全性、可审计性和运维可控性
- 为后续新增子应用提供标准接入方式

### 2.3 适用范围

本版本适用于企业内部管理后台、运营系统、数据后台、轻量业务子系统等场景。

不包含：

- 面向外部消费者的大规模互联网账号体系
- 社交登录、第三方身份联合登录
- ABAC / PBAC 等复杂策略引擎
- 多租户隔离的深度能力
- 跨地域高可用容灾设计

---

## 3. 系统范围与边界

### 3.1 系统组成

系统由三类核心角色组成：

1. `Browser`
2. `Portal（Next.js BFF）`
3. `IdP（Better Auth）`

同时存在第四类外围角色：

4. `子应用（Clients / Downstream Apps）`

### 3.2 系统职责划分

#### Browser 职责

- 发起页面访问
- 跟随 302 跳转
- 自动携带 Cookie
- 接收回调中的 `code`、`state`

Browser 不负责：

- 不处理 `token` 交换
- 不保存 `refresh_token`
- 不承担认证判断逻辑
- 不做真正的权限判定

#### Portal 职责

- 统一门户 UI 与管理后台承载
- 作为 OIDC Client 与 IdP 通信
- 执行 `/authorize` 跳转发起
- 执行 `/token` 换取 Token
- 建立和维护 `Portal Session`
- 提供 `/api/me`、登录、登出、权限上下文等接口
- 统一对前端返回“当前用户是否已登录、能看什么、能做什么”

Portal 不负责：

- 不作为认证源头
- 不替代 IdP 维护全局 SSO 登录态
- 不让前端直接持有敏感 Token

#### IdP 职责

- 用户身份认证
- 管理 IdP Session
- 提供标准 OIDC / OAuth 2.0 能力
- 处理 `/authorize`、`/token`、`/userinfo`、`/jwks`
- 基于 IdP Session 支撑全局 SSO

IdP 不负责：

- 不承接 Portal 的业务权限模型管理
- 不负责 Portal 页面路由和菜单编排
- 不负责子应用的业务数据权限判断

#### 子应用职责

- 作为独立 OAuth/OIDC Client 接入 IdP
- 按统一接入规范发起认证
- 消费自身用户上下文与权限信息

子应用不负责：

- 不直接读取 IdP Cookie
- 不绕过 Portal / IdP 自建不兼容认证流程
- 不共享其他应用的 Client 配置

### 3.3 设计边界原则

- 浏览器负责跳转，不负责认证
- Portal 后端才是 OIDC Client
- SSO 依赖 IdP Session，不依赖 Token
- Portal Session 不等于 IdP Session，也不等于 Token

---

## 4. 用户与角色

### 4.1 用户角色

- `平台超级管理员`：管理全局组织、用户、角色、应用和系统配置
- `企业管理员`：管理本企业内的用户、部门、角色、授权
- `普通员工`：登录 Portal，访问授权范围内的菜单和子应用
- `子应用管理员`：维护某个应用的 Client 配置、回调地址与启停状态

### 4.2 典型使用场景

- 员工登录 Portal 后访问报表系统、订单系统、审批系统，无需重复登录
- 管理员在 Portal 中创建角色并分配菜单权限、接口权限和数据范围
- 新增业务系统时，在 Portal 中注册 Client 后即可按规范接入 SSO

---

## 5. 核心概念模型

### 5.1 四类状态

系统中必须严格区分四类状态：

1. `Browser Cookie`
2. `Portal Session`
3. `IdP Session`
4. `OAuth / OIDC Token`

### 5.2 一句话关系

`cookie 是标识，session 是状态，token 是凭证`

### 5.3 概念定义

#### Cookie

- 浏览器自动携带的标识载体
- 一般仅保存 `sessionId` 或匿名态校验信息
- 必须使用 `HttpOnly`

#### Portal Session

- 表示“用户在 Portal 是否登录”
- 由 Portal 服务端存储并维护
- 用于承载用户基础信息、会话生命周期与必要的 Token 引用

#### IdP Session

- 表示“用户在整个认证中心是否登录”
- 由 IdP 存储并维护
- 是 SSO 成立的前提

#### Token

- `access_token`：访问资源凭证
- `id_token`：身份声明
- `refresh_token`：续签 access token 的凭证

### 5.4 不可混淆原则

- `Portal Session` 失效，不代表 `IdP Session` 失效
- `IdP Session` 存在，不代表 Portal 已建立业务会话
- `refresh_token` 成功，不等于 Portal Session 自动续命
- Cookie 只帮助找到 Session，不承载完整用户态

---

## 6. 总体架构

### 6.1 逻辑架构

```text
Browser
  -> Portal Frontend / BFF (Next.js)
      -> Session Store (Redis)
      -> RBAC / Org / Client Management
      -> IdP (Better Auth)
           -> IdP Session Store (Redis)
           -> User Auth / OIDC Endpoints
  -> Sub Applications
      -> IdP
```

### 6.2 技术选型

- `Portal`：Next.js（App Router + Route Handlers）
- `IdP`：Next.js + Better Auth，作为统一认证中心
- `Session Store`：Redis
- `DB`：PostgreSQL 16
- `ORM / SQL Builder`：Drizzle ORM
- `UI`：shadcn/ui
- `CSS`：tailwindcss@latest
- `权限模型`：RBAC
- `前后端通信模式`：BFF

补充说明：

- Better Auth v1.0 计划使用核心认证能力、`emailAndPassword`、`@better-auth/oauth-provider`、`jwt`
- 官方旧 `OIDC Provider` 插件已标注将被 `OAuth Provider` 取代，因此不作为本项目主方案
- v1.0 明确启用用户名密码登录、授权码模式、PKCE、Token 刷新、`jwks`、密码重置
- v1.0 明确不启用 MFA、Passkey、Magic Link、短信登录、独立账号中心、第三方社交登录

### 6.3 应用规划

建议采用多应用仓库结构：

- `apps/portal`：Portal 门户 + 管理后台 + BFF API
- `apps/idp`：Next.js + Better Auth 认证应用，承载登录页、认证确认页、错误页、OIDC API
- `packages/contracts`：共享类型、权限码、错误码、OIDC 常量
- `packages/config`：环境变量 schema、日志与安全配置

说明：

- `Portal` 和 `IdP` 不混合部署为同一个应用
- `Portal` 是 OIDC Client
- `IdP` 是认证中心
- 此拆分必须与职责边界保持一致

### 6.4 架构关系与数据归属

`Browser`

- 只负责跳转和携带 Cookie

`Portal`

- 读写业务主数据
- 建立 `Portal Session`
- 管理用户、部门、角色、权限、菜单、Client

`IdP`

- 管理认证凭证、OIDC 运行态、`IdP Session`
- 基于 Client 配置与身份主体执行认证与授权
- 作为独立认证 Web 应用部署
- 承载登录页、认证确认页、错误页与 OIDC API
- 不承载 Portal 业务管理后台

`PostgreSQL`

- 按逻辑域分为 `portal_core` 与 `idp_auth`

`Redis`

- 按前缀分为 `portal:*` 与 `idp:*`

说明：

- `portal_core` 保存业务主数据
- `idp_auth` 保存 Better Auth 认证持久化数据
- `idp_auth` 基础物理表至少包含 Better Auth 核心 4 表：`user / session / account / verification`
- 按当前 v1.0 计划，插件表预计至少包含 `oauthClient / oauthRefreshToken / oauthAccessToken / oauthConsent / jwks`
- 最终以 Better Auth 官方生成结果为准
- `portal:*` 保存 Portal Session 与登录临时上下文
- `idp:*` 保存 IdP Session
- `IdP` 通过标准 OIDC 协议与 Portal、子应用交互
- `apps/idp` 同时提供页面能力与 API 能力
- `Client` 配置由 Portal 管理，IdP 直连只读消费

### 6.5 冻结联动规则

- Portal 创建用户时，必须同步建立认证身份映射
- Portal 禁用用户时，IdP 必须立即拒绝该用户的新登录
- Portal 发起重置密码，IdP 执行认证凭证更新
- v1.0 不做 Client 配置异步复制
- v1.0 `apps/idp` 页面范围仅包含登录页、认证确认页、错误页

### 6.6 初始化要求

- `Next.js` 应用必须使用官方最新 `create-next-app` CLI
- 优先使用交互式初始化
- `Portal` UI 组件库固定使用 `shadcn/ui`
- 样式固定使用 `tailwindcss@latest`
- `apps/idp` 也使用最新 `create-next-app` 初始化

### 6.7 技术约束

- Portal 与 IdP 必须使用 HTTPS
- Session 必须服务端存储
- Token 不允许落地浏览器 `localStorage`
- 所有登录、授权流程均按 OIDC/OAuth2 标准链路执行

---

## 7. 认证与登录流程

### 7.1 Portal 登录流程

完整链路如下：

1. 浏览器访问 Portal 页面
2. 前端调用 `/api/me`
3. Portal 判断未登录
4. 前端跳转 `/api/auth/login`
5. Portal 302 到 IdP `/authorize`
6. 用户在 IdP 完成登录
7. IdP 302 回 Portal `/api/auth/callback?code=xxx&state=xxx`
8. Portal 后端调用 IdP `/token`
9. Portal 获取 `id_token / access_token / refresh_token`
10. Portal 解析用户身份，建立 `Portal Session`
11. Portal 返回 `Set-Cookie: portal_session=...`
12. 浏览器回到 Portal 页面，后续请求携带 Portal Cookie

### 7.2 核心原则

浏览器只负责：

- 跳转
- 携带 Cookie
- 携带回调参数

Portal 后端负责：

- 发起 `/authorize`
- 调用 `/token`
- 校验 `state / nonce / PKCE`
- 校验并绑定登录前 `redirect`
- 建立与校验 Session

### 7.3 关键链路

`code -> token -> id_token -> user -> session`

### 7.4 错误处理要求

- `state` 不匹配：立即拒绝登录并记录审计日志
- `nonce` 校验失败：拒绝登录
- `code` 失效或重复使用：提示登录失效并重新发起登录
- `/token` 调用失败：返回统一错误页，不暴露内部堆栈
- 用户状态禁用：拒绝建立 Session

### 7.5 回跳地址安全规则

- `/api/auth/login` 允许携带 `redirect`
- `redirect` 仅允许 Portal 站内相对路径
- 禁止绝对 URL、协议相对 URL、跨域 URL
- Portal 发起登录时必须将 `redirect` 与 `state` 绑定保存
- `/api/auth/callback` 只能读取与当前 `state` 匹配的 `redirect`
- 缺失或非法时统一回首页 `/`

---

## 8. SSO 设计

### 8.1 SSO 原理

子应用发起认证时：

1. 子应用重定向到 IdP `/authorize`
2. 浏览器自动携带 `idp_session` Cookie
3. IdP 判断用户已登录
4. IdP 直接签发授权码 `code`
5. 子应用完成自身 `code -> token` 交换

### 8.2 核心结论

`SSO 依赖 IdP Session（服务端 + Cookie），不是 Token`

### 8.3 关键约束

- 子应用不读取 IdP Cookie 内容
- 浏览器只负责自动携带 Cookie
- IdP 基于 Session 判断是否已登录
- 不允许通过前端缓存 Token 实现伪 SSO

### 8.4 登出协同

v1.0 默认支持：

- Portal 登出
- IdP Session 同步失效
- 新请求不会因残留 IdP Session 自动重新登录

v1.0 不强制支持：

- Front-channel logout
- Back-channel logout
- 所有子应用实时联动退出

说明：

v1.0 的“退出登录”定义为：当前 Portal Session 删除，同时对应 IdP Session 失效，因此用户再次访问 Portal 或重新发起新的 OIDC 流程时必须重新登录。跨所有已打开子应用的实时联动退出可纳入后续版本。

---

## 9. Session 体系设计

### 9.1 Portal Session 数据结构

推荐存储于 Redis：

```json
{
  "sessionId": "sess_123",
  "userId": "u_1",
  "createdAt": 1710000000,
  "lastAccessAt": 1710001200,
  "absoluteExpiresAt": 1710028800,
  "idleTimeoutSec": 1800,
  "accessToken": "...",
  "refreshToken": "...",
  "idToken": "...",
  "clientId": "portal-web",
  "ip": "x.x.x.x",
  "userAgent": "Mozilla/5.0"
}
```

### 9.2 Cookie 设计

```http
Set-Cookie: portal_session=xxx; HttpOnly; Secure; SameSite=Lax; Path=/
```

要求：

- `HttpOnly`：防止前端 JS 读取
- `Secure`：仅 HTTPS 传输
- `SameSite=Lax`：平衡登录跳转与 CSRF 风险
- Cookie 内容应为随机 `sessionId`，不可直接塞入完整用户数据

### 9.3 生命周期策略

建议采用双超时模型：

- `Absolute Timeout`：例如 `8小时`
- `Idle Timeout`：例如 `30分钟`

规则：

- 会话建立时写入绝对过期时间
- 用户访问时更新 `lastAccessAt`
- 超过绝对时长必须重新登录
- 超过空闲时长会话失效
- `refresh_token` 刷新成功不延长绝对过期时间

### 9.4 生命周期结论

Portal Session 生命周期：

- 创建时写入 `absoluteExpiresAt`
- 活跃访问仅刷新 `lastAccessAt`
- 超过 `idle timeout` 立即失效
- 超过 `absolute timeout` 必须重新登录
- `refresh_token` 仅用于续签 `access_token`，不改变 Portal 登录生命周期

IdP Session 生命周期：

- IdP 登录成功时建立
- 用于 `/authorize` 阶段判断是否需要重新认证
- Portal 登出时必须同步销毁
- 过期或显式登出后，不得继续支持 SSO 免登

### 9.5 会话校验逻辑

每次请求进入 Portal 时执行：

1. 从 Cookie 读取 `sessionId`
2. 查询 Redis Session
3. 判断 Session 是否存在
4. 判断是否超过 `absoluteExpiresAt`
5. 判断 `now - lastAccessAt > idleTimeoutSec`
6. 如合法，更新 `lastAccessAt`
7. 如需调用下游 API，检查 `access_token` 是否即将过期
8. 必要时执行 `refresh_token` 刷新

### 9.6 清理策略

- 依赖 Redis TTL 自动清理
- 不依赖浏览器关闭
- 支持显式登出删除 Session
- 支持后台强制下线

### 9.7 会话安全要求

- Session ID 必须使用高强度随机值
- 登录后必须重新签发 Session，防止 Session Fixation
- 敏感操作可要求二次校验
- 建议记录 IP、UA、登录时间、最近活跃时间

---

## 10. Token 管理

### 10.1 Token 类型

- `authorization_code`：授权码，只能短时间一次性使用
- `access_token`：访问 IdP 或受保护资源的凭证
- `id_token`：用户身份信息声明
- `refresh_token`：刷新 access token 的凭证

### 10.2 存储策略

Portal 侧建议：

- `access_token`：服务端 Session 存储
- `refresh_token`：服务端 Session 存储，必须加密或至少受控存储
- `id_token`：按需短期存储，主要用于初次身份解析与审计

禁止：

- Token 存浏览器 `localStorage`
- Token 暴露给前端页面脚本
- 多个系统共享同一个 Client 与 Token

### 10.3 刷新策略

采用懒刷新：

- 调用受保护 API 前检查 `access_token` 剩余有效期
- 若即将过期，则使用 `refresh_token` 刷新
- 若刷新失败，则当前 Portal Session 置为失效
- 失效后要求用户重新走登录流程

### 10.4 原则

`refresh token 用于续命 access token，不用于续 Portal session`

### 10.5 安全要求

- `refresh_token` 必须仅在服务端流转
- 刷新失败必须记录日志并触发会话清理
- Token 解析必须校验签名、过期时间、发行方、受众

---

## 11. IdP Session 设计

### 11.1 数据结构

```json
{
  "sessionId": "abc123",
  "userId": "u_1",
  "createdAt": 1710000000,
  "expiresAt": 1710028800,
  "loginMethod": "password"
}
```

### 11.2 存储方式

- Redis，支持 TTL
- 可选数据库持久化审计记录

### 11.3 Cookie 设计

```http
Set-Cookie: idp_session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/
```

### 11.4 IdP Session 作用

- 判断用户是否需要重新登录
- 支撑跨应用 SSO
- 作为 `/authorize` 阶段是否可直接签发 `code` 的依据

### 11.5 IdP 与 Portal 关系

- IdP Session 是全局认证态
- Portal Session 是门户业务登录态
- Portal 不应直接复用 IdP Session 作为自己的业务 Session
- Portal 登出必须触发 IdP Session 失效

---

## 12. 权限中心设计

### 12.1 模型范围

Portal 负责管理：

- 用户
- 部门
- 角色
- 权限
- 菜单
- 数据范围

### 12.2 RBAC 模型

推荐关系如下：

- 用户属于一个主部门
- 用户可拥有多个角色
- 角色绑定多个权限
- 权限可分为菜单权限、接口权限、数据权限

### 12.3 权限码设计建议

统一使用字符串权限码，例如：

- `user.read`
- `user.create`
- `user.update`
- `user.resetPassword`
- `user.forceLogout`
- `department.read`
- `department.create`
- `department.update`
- `department.delete`
- `role.read`
- `role.create`
- `role.update`
- `role.delete`
- `permission.read`
- `permission.create`
- `permission.update`
- `permission.delete`
- `client.read`
- `client.create`
- `client.update`
- `client.rotateSecret`
- `role.assign`
- `report.export`

### 12.4 数据权限建议

v1.0 建议支持基础数据范围：

- `ALL`：全部数据
- `DEPT`：本部门
- `DEPT_AND_SUB`：本部门及子部门
- `SELF`：仅本人
- `CUSTOM`：自定义授权部门

### 12.5 权限判定原则

- 页面菜单展示由 Portal 前端依据后端返回权限上下文进行控制
- 真正接口权限必须由后端判定
- 子应用内部业务权限由子应用自行判定，v1.0 不做统一跨应用业务权限下发

---

## 13. 数据模型设计

说明：

- 接口层与产品视角中的 `id` 默认指外部字符串 ID
- 数据库物理设计采用内部 `bigint id` + 外部 `public_id` 双标识模型
- 数据库关系连接统一使用内部 `bigint id`

### 13.1 用户模型

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 用户 ID |
| username | string | 登录名，唯一 |
| name | string | 姓名 |
| email | string | 邮箱，可选唯一 |
| mobile | string | 手机号，可选唯一 |
| status | enum | 启用 / 禁用 / 锁定 |
| deptId | string | 主部门 ID |
| createdAt | datetime | 创建时间 |
| updatedAt | datetime | 更新时间 |

说明：

- 用户业务主档不存密码摘要
- 认证身份、密码摘要、授权码与 Token 运行态统一放在 `idp_auth`

### 13.2 部门模型

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 部门 ID |
| parentId | string | 父部门 ID |
| name | string | 部门名称 |
| code | string | 部门编码 |
| sort | int | 排序 |
| status | enum | 启用 / 禁用 |

### 13.3 角色模型

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 角色 ID |
| name | string | 角色名称 |
| code | string | 角色编码 |
| dataScope | enum | 数据范围 |
| status | enum | 启用 / 禁用 |
| remark | string | 备注 |

### 13.4 权限模型

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 权限 ID |
| code | string | 权限码，唯一 |
| name | string | 权限名称 |
| type | enum | menu / api / data |
| resource | string | 资源标识 |
| action | string | 动作标识 |

### 13.5 应用 Client 模型

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 应用 ID |
| clientId | string | OAuth Client ID |
| name | string | 应用名称 |
| status | enum | 启用 / 禁用 |

补充说明：

- `redirectUris`、`scopes`、`grantTypes` 在数据库中采用子表规范化建模
- `clientSecret` 不作为普通查询字段长期暴露
- Secret 仅在创建或轮换时一次性展示，历史记录进入 `client_secret_histories`

### 13.6 关联关系

- 用户和角色：多对多
- 角色和权限：多对多
- 用户和部门：一对一主部门

---

## 14. 管理功能需求

### 14.1 用户管理

必须支持：

- 创建用户
- 编辑用户
- 禁用 / 启用用户
- 重置密码
- 分配角色
- 绑定部门
- 查询用户详情

建议支持：

- 批量导入
- 强制下线
- 最近登录信息查看

### 14.2 部门管理

必须支持：

- 树结构展示
- 创建、编辑、删除部门
- 维护层级关系
- 绑定负责人
- 数据权限关联

### 14.3 角色权限管理

必须支持：

- 创建角色
- 配置权限码
- 关联菜单
- 关联数据范围
- 给用户分配角色

### 14.4 应用 Client 管理

必须支持：

- 注册 OAuth Client
- 配置 `redirect_uri`
- 配置 `scope`
- 启用 / 禁用 Client
- 查看 Client 使用情况

建议支持：

- Secret 轮换
- 应用管理员分配

---

## 15. 接口设计

### 15.1 Portal 认证接口

#### `GET /api/me`

用途：

- 返回当前登录用户信息与权限上下文

返回示例：

```json
{
  "authenticated": true,
  "user": {
    "id": "u_1",
    "name": "张三",
    "deptId": "d_1",
    "roles": ["admin"],
    "permissions": ["user.read", "client.read"]
  }
}
```

#### `GET /api/auth/login`

用途：

- 生成 `state`、`nonce`、`code_verifier`
- 校验并保存登录前 `redirect`
- 跳转至 IdP `/authorize`

#### `GET /api/auth/callback`

用途：

- 接收 `code`
- 调用 `/token`
- 建立 Portal Session

#### `POST /api/auth/logout`

用途：

- 删除 Portal Session
- 清理 Portal Cookie
- 同步触发 IdP Session 失效

### 15.2 Portal 管理接口

- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/:id`
- `GET /api/admin/roles`
- `POST /api/admin/roles`
- `GET /api/admin/departments`
- `POST /api/admin/departments`
- `GET /api/admin/clients`
- `POST /api/admin/clients`

统一要求：

- 必须鉴权
- 必须校验权限码
- 必须记录操作审计日志
- 写操作必须做字段级校验和唯一性校验

### 15.3 IdP 标准接口

- `GET /authorize`
- `POST /token`
- `GET /userinfo`
- `GET /.well-known/openid-configuration`
- `GET /jwks`

### 15.4 接口通用规范

- 返回统一错误码和错误消息结构
- 敏感接口必须记录 `operatorId`、IP、UA、时间
- 管理接口默认分页

推荐错误结构：

```json
{
  "code": "UNAUTHORIZED",
  "message": "session expired",
  "requestId": "req_xxx"
}
```

---

## 16. 子应用接入方案

### 16.1 阶段一

Portal 内嵌子模块：

- 子功能作为 Portal 内页承载
- 不独立认证
- 复用 Portal Session

适用场景：

- 初期业务规模较小
- 系统耦合度高
- 接入速度优先

### 16.2 阶段二

独立子应用接入 SSO：

- 每个子应用注册独立 Client
- 通过 IdP `/authorize` 走标准 OIDC 流程
- 借助 `idp_session` 完成免登

### 16.3 接入要求

- 每个子应用必须独立配置 `client_id`
- 每个子应用必须配置合法 `redirect_uri`
- 必须支持 `state`、`nonce`、PKCE
- 禁止多个子应用共用一个 Client
- 子应用回调地址必须按白名单严格校验

---

## 17. 安全设计

### 17.1 必做项

- 使用 PKCE
- 使用 `state`
- 使用 `nonce`
- 全链路 HTTPS
- `HttpOnly` Cookie
- Session 服务端存储
- Token 服务端存储
- 回调地址白名单校验
- JWT 签名和声明校验

### 17.2 禁止项

- Token 存 `localStorage`
- 前端自行判定是否有后端接口权限
- 多应用共用一个 Client
- 以 Cookie 是否存在替代 Session 校验
- 将完整用户信息明文放入 Cookie

### 17.3 CSRF / XSS 风险控制

- Cookie 采用 `SameSite=Lax`
- 对状态变更接口增加 CSRF 防护策略
- 前端严格避免 `dangerouslySetInnerHTML`
- 输出内容统一转义

### 17.4 暴力破解与风控建议

- 登录失败次数限制
- 图形验证码或滑块校验预留
- 账号锁定机制
- 异常 IP 告警

### 17.5 审计要求

必须记录：

- 登录成功 / 失败
- 登出
- Token 刷新失败
- 用户创建、角色变更、权限变更
- Client 注册与 Secret 更新

---

## 18. 非功能需求

### 18.1 性能

- `/api/me` 应尽量低延迟，目标 `P95 < 200ms`
- 登录主链路目标 `P95 < 1.5s`
- Redis Session 查询应保证毫秒级

### 18.2 可用性

- Session 存储具备 TTL 与高可用能力
- IdP 不可用时应有明确错误页与告警
- Portal 与 IdP 配置变更应可灰度发布

### 18.3 可维护性

- Portal、IdP、管理后台职责清晰
- 配置项集中管理
- 错误码、日志、审计结构统一

### 18.4 可观测性

- 请求日志
- 登录链路日志
- 授权码交换日志
- Session 命中与失效指标
- Token 刷新成功率指标

---

## 19. 页面与交互建议

### 19.1 Portal 必有页面

- 登录态校验入口页
- 首页工作台
- 应用导航页
- 用户管理
- 部门管理
- 角色管理
- 权限管理
- Client 管理
- 登录审计
- 操作审计
- 无权限提示页

### 19.2 Portal 可选页面

- 用户中心
- Session 失效统一提示页

### 19.3 Portal v1.0 不做

- 独立账号中心
- MFA 设置页
- 第三方身份绑定页
- 子应用业务页面

### 19.4 IdP 必有页面

- 登录页
- 认证确认页
- 错误页

### 19.5 IdP 可选页面

- 简单密码重置页

说明：

- 若密码重置采用邮件跳转页承载，可放在 `apps/idp`
- 若采用后台发起后直接完成重置，可不单独建设完整页面流程

### 19.6 IdP v1.0 不做

- 用户管理后台
- 独立账号中心
- MFA 管理页
- 社交登录配置页
- 第三方身份源管理页

### 19.7 交互原则

- 未登录访问受保护页面时自动跳转登录
- Session 失效时统一跳转登录页或统一提示页
- 权限不足返回明确提示，不暴露系统内部资源信息

---

## 20. 版本范围

### 20.1 v1.0 必须交付

- Portal 登录 / 登出
- Better Auth IdP 基础 OIDC 能力接入
- Redis Session
- 用户 / 部门 / 角色 / 权限 / Client 基础管理
- `/api/me`
- Portal 侧 RBAC
- 单应用或少量应用 SSO 接入
- 审计日志基础能力
- Portal 登出同步失效 IdP Session

### 20.2 v1.0 可选增强

- 强制下线
- Secret 轮换
- 登录风控
- 数据权限细化

### 20.3 后续版本规划

- 全局登出联动
- 多租户支持
- MFA
- 第三方身份源接入
- 更细粒度策略控制

---

## 21. 风险与注意事项

### 21.1 常见误区

- 把 `token` 当作 SSO 依据
- 把 `Portal Session` 当作 `IdP Session`
- 把前端权限展示当作真实鉴权
- 把浏览器关闭当作会话失效条件
- 只删除 Portal Session 却误以为已经完全登出

### 21.2 实施风险

- Better Auth 的 OIDC 兼容能力需在项目初期验证
- 子应用若不按标准流程接入，将破坏 SSO 一致性
- Session 与 Token 生命周期策略如果设计不清，会导致“明明登录了却频繁掉线”或“会话无限续命”
- 登录回跳地址如果不绑定 `state` 且不做站内校验，会引入开放重定向风险

### 21.3 关键落地建议

- 第一阶段先打通 `Portal <-> IdP <-> Redis`
- 优先完成 `/api/me`、登录、登出、Session 校验中间件
- 权限中心先做标准 RBAC，不提前引入复杂策略模型
- 子应用接入必须提供接入规范文档和 SDK 示例
- 数据模型先按“一个用户一个主部门”落地，不提前扩展多部门

---

## 22. 最终设计原则

### 原则 1

浏览器负责跳转，不负责认证

### 原则 2

Portal 后端才是 OIDC Client

### 原则 3

SSO 依赖 IdP Session，不依赖 Token

### 原则 4

Portal Session 不等于 IdP Session，不等于 Token

---

## 23. 最终总结

`Portal` 管“你在门户是否登录”。

`IdP` 管“你在整个系统是否登录”。

`Token` 管“你能访问什么资源”。

如果只记住一句话，就是：

`cookie 是标识，session 是状态，token 是凭证；Portal 管门户登录，IdP 管全局登录，权限中心管你能做什么。`
