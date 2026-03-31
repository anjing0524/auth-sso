# 小企业统一门户 + SSO + 权限中心技术选型

- 版本：`v1.0`
- 目标：支持 `Portal + IdP + RBAC + SSO`

---

## 最终选型

### 1. Portal

- 框架：`Next.js 16`，`App Router`
- 接口层：`Route Handlers`
- 语言：`TypeScript`
- 校验：`Zod`
- UI：`shadcn/ui`
- 样式：`tailwindcss@latest`
- 运行模式：`BFF`

选择原因：

- 适合 Portal 作为前后端一体的 BFF
- Route Handlers 天然适合 `/api/*` 契约落地
- TypeScript + Zod 便于接口和 DTO 统一
- `shadcn/ui + tailwindcss@latest` 适合后台和门户 UI 的快速一致建设

### 2. IdP

- 认证中心：`Better Auth`
- 承载应用：`Next.js 16`，`App Router`
- 协议：`OIDC / OAuth 2.0`
- 接口层：`Route Handlers`
- 页面层：`登录页 / 认证确认页 / 错误页`
- 部署形态：`独立认证 Web 应用`
- 对外域名：`idp.<domain>`
- 会话存储：`Redis idp:*`
- 持久化：`PostgreSQL.idp_auth`

选择原因：

- 满足统一认证中心定位
- 可承接 `authorize / token / userinfo / jwks`

**技术验证：** Better Auth OAuth/OIDC Provider 能力已通过技术探针验证 → [技术探针-Better-Auth-OIDC-Provider-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/技术探针-Better-Auth-OIDC-Provider-v1.0.md)

### 2.1 Better Auth 技术架构

`apps/idp` 不是 Portal 的一个模块，而是独立 IdP Web 应用：

- 作为独立 Web 应用部署
- 负责登录页、认证确认页、OIDC 端点、SSO 会话
- 不承载用户、角色、权限、菜单的管理后台
- 不直接对外暴露 Portal 业务接口

### 2.1.1 Better Auth 插件选型

v1.0 计划采用：

- Better Auth 核心认证能力
- `emailAndPassword`
- `@better-auth/oauth-provider`
- `jwt`

说明：

- 当前官方 `OIDC Provider` 插件已标注“将被 `OAuth Provider` 取代”
- 因此 v1.0 优先采用 `OAuth 2.1 Provider` 插件，并以 `openid` scope 提供 OIDC 兼容能力
- `jwt` 插件用于 `jwks` 与 JWT 签发能力
- v1.0 不计划启用 `organization`、`twoFactor`、`admin` 等扩展插件

### 2.1.2 Better Auth 启用能力范围

v1.0 启用：

- 用户名密码登录
- Session 管理
- OAuth 2.1 Provider
- `openid` scope
- 授权码模式
- PKCE
- Access Token / Refresh Token
- `jwks`
- 密码重置

v1.0 不启用：

- `organization`
- `twoFactor`
- `passkey`
- `magicLink`
- `emailOtp`
- `phoneNumber`
- `admin`
- `apiKey`
- 社交登录

说明：

- 新增插件会直接影响 Better Auth 物理表结构
- 任何插件增减都必须重新执行官方生成命令并重新评审

### 2.2 Better Auth 负责的能力

- 用户认证
- OIDC 标准端点
- 授权码与 Token 运行态
- `IdP Session`
- 基于 `idp_session` 的 SSO 免登判断

### 2.3 Better Auth 不负责的能力

- 不负责 RBAC 业务模型
- 不负责部门树和菜单管理
- 不负责 Portal Session
- 不负责子应用的业务权限判定

### 2.4 Better Auth 与 Portal 的关系

- `Portal` 是 OIDC Client
- `IdP` 是认证中心
- `Portal` 通过标准 OIDC 流程与 `IdP` 通信
- `Portal` 不绕过 OIDC 直接承担认证源角色
- `IdP` 同时承载页面与 API，不是纯后端进程

### 2.5 Better Auth 与数据库关系

- Better Auth 认证运行态使用 `PostgreSQL.idp_auth`
- Better Auth 核心物理表至少包含 `user / session / account / verification`
- 按当前 v1.0 计划，还会追加：
  - `oauthClient`
  - `oauthRefreshToken`
  - `oauthAccessToken`
  - `oauthConsent`
  - `jwks`
- Better Auth 通过主体映射关系识别业务用户
- `Client` 配置由 `portal_core` 管理，IdP 直连只读消费
- `IdP Session` 不落 PostgreSQL，固定存 Redis
- `IdP` 的页面路由与 OIDC 端点统一由 `apps/idp` 承载
- 最终表结构必须以 Better Auth 官方生成结果为准，不手工猜测内部表

### 2.6 Better Auth 联动规则

- Portal 创建用户时，同步建立认证身份映射
- Portal 禁用用户时，IdP 立即拒绝新登录
- Portal 发起重置密码，IdP 执行认证域更新
- v1.0 不引入 Client 配置异步复制链路

### 2.7 Better Auth 实施配置稿

以下配置作为 v1.0 开发默认实施口径：

#### 环境变量

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `DATABASE_URL`
- `REDIS_URL`

补充约束：

- `BETTER_AUTH_SECRET` 必须为高强度随机值，长度不少于 32 字节
- `BETTER_AUTH_URL` 固定为 IdP 对外访问基址，例如 `https://idp.example.com`

#### 路由与端点暴露

- `apps/idp` 统一承载 Better Auth 服务端配置与路由
- v1.0 对外协议端点固定为：
  - `GET /authorize`
  - `POST /token`
  - `GET /userinfo`
  - `GET /jwks`
- Better Auth 的实际路由配置必须确保外部看到的协议路径与接口契约一致

#### 数据库与 schema 生成

- Drizzle 作为业务侧 ORM / SQL Builder
- Better Auth 内部表结构不手写维护
- 每次新增或变更 Better Auth 插件后，必须重新执行官方 schema 生成

推荐命令：

```bash
npx @better-auth/cli@latest generate
```

#### Session 策略

- `IdP Session` 默认落 `Redis idp:*`
- Better Auth 内部 `session` 表仍保留为认证持久化表的一部分
- 不把 Portal Session 复用为 Better Auth Session

#### 安全配置

- 使用 HTTPS Cookie
- 启用安全 Cookie
- 配置 `trustedOrigins`
- 不关闭 CSRF / origin 校验
- 在反向代理场景下显式配置 IP 头解析策略

#### 密码重置配置

- v1.0 允许 Portal 发起密码重置
- Better Auth 负责执行认证域更新
- 若采用邮件跳转方式，密码重置页由 `apps/idp` 承载
- 若采用后台管理直接重置，则不扩展完整自助找回密码产品流程

### 3. 数据层

- 主数据库：`PostgreSQL 16`
- ORM / SQL Builder：`Drizzle ORM`
- Session：`Redis`

选择原因：

- PostgreSQL 适合权限、组织、审计类关系模型
- Drizzle 更贴近 SQL，类型安全好，性能与可控性更适合本项目
- Redis 适合 Session、短期认证上下文和会话索引

### 4. 前端状态

- Portal 页面优先走服务端会话和接口获取
- 不在浏览器存储敏感 Token
- 前端只消费 `/api/me` 等 BFF 数据

### 5. 工程基础

- 包管理：`pnpm`
- 代码规范：`ESLint + TypeScript strict`
- 测试建议：`Vitest + Playwright`
- 部署建议：`Docker`

### 6. 应用规划

建议采用多应用仓库结构：

- `apps/portal`：Next.js Portal，承载门户、管理后台、BFF API
- `apps/idp`：Next.js + Better Auth 独立认证应用，承载登录页、认证确认页、错误页、OIDC API、SSO、IdP Session
- `packages/contracts`：共享类型、错误码、权限码、OIDC 常量
- `packages/config`：环境变量 schema、安全配置、日志配置

说明：

- `Portal` 和 `IdP` 不应混在同一个应用中
- `Portal` 是 OIDC Client，`IdP` 是认证中心
- 该拆分更符合当前需求文档中的职责边界
- `Portal` 与 `IdP` 都是 Web 应用，但职责完全不同

### 7. 初始化方式

`Next.js` 应用创建要求：

- 必须使用官方最新 `create-next-app` CLI
- 优先使用交互式初始化
- 推荐命令：`pnpm create next-app`
- 交互式选择建议：
  - `TypeScript = Yes`
  - `Linter = ESLint`
  - `React Compiler = Yes`
  - `Tailwind CSS = Yes`
  - `src/ directory = Yes`
  - `App Router = Yes`
  - `Import Alias = @/*`

适用范围：

- `apps/portal`
- `apps/idp`

`shadcn/ui` 初始化要求：

- 使用 `shadcn@latest`
- Next.js 项目推荐命令：`pnpm dlx shadcn@latest init -t next`
- 如果是 monorepo，使用：`pnpm dlx shadcn@latest init -t next --monorepo`

`Tailwind CSS` 要求：

- 使用 `tailwindcss@latest`
- 按官方 Next.js 最新安装方式配置
- 使用 `@tailwindcss/postcss`
- 在全局样式中使用 `@import "tailwindcss";`

---

## 不选这些方案的原因

- 不选前后端完全分离 SPA + localStorage Token：不符合本项目安全边界
- 不选 MongoDB：组织、角色、权限、审计更适合关系模型
- 不选把 Session 直接落数据库：高频会话读写不如 Redis 合适

---

## v1.0 落地组合

```text
Next.js App Router
  + Route Handlers
  + TypeScript
  + Zod
  + shadcn/ui
  + tailwindcss@latest
  + Drizzle ORM
  + PostgreSQL
  + Redis
  + Better Auth
```

这套组合适合直接进入建表、接口开发和认证联调。

---

## 设计系统

UI 开发遵循 [DESIGN.md](/Users/liushuo/code/干了科技/auth-sso/DESIGN.md) 定义的设计规范：

- **主色调：** #0066FF
- **字体：** Geist（英文）+ PingFang SC（中文）
- **组件库：** shadcn/ui
- **动效系统：** 克制功能性动效
- **暗黑模式：** 支持
