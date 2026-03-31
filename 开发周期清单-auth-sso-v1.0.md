# 小企业统一门户 + SSO + 权限中心开发周期清单

- 版本：`v1.0`
- 适用范围：`apps/portal + apps/idp + RBAC + SSO`
- 目标：把冻结评审稿转为可执行的研发推进清单

---

## 1. 周期目标

围绕以下冻结方案完成 v1.0 落地：

- `apps/portal`：门户 + 管理后台 + BFF
- `apps/idp`：`Next.js + Better Auth` 独立认证 Web 应用
- `PostgreSQL.portal_core`：业务主数据
- `PostgreSQL.idp_auth`：Better Auth 认证持久化数据
- `Redis portal:*`：Portal Session 与登录临时上下文
- `Redis idp:*`：IdP Session

交付目标：

- Portal 登录、登出、`/api/me` 可用
- IdP OIDC 主链路可用
- RBAC 管理能力可用
- 至少 1 个子应用接入 SSO
- 会话生命周期、安全边界、审计能力可落地

---

## 2. 建议总周期

建议按 `4 周` 组织：

1. 第 1 周：初始化、基础工程、数据库与 Better Auth 集成
2. 第 2 周：认证主链路、Session 生命周期、Portal 登录态
3. 第 3 周：权限中心、管理后台接口与页面
4. 第 4 周：子应用接入、测试、安全加固、上线准备

---

## 3. 阶段拆解

## 3.1 阶段 A：冻结与启动准备 ✅

### 目标

确保技术边界、数据边界、插件范围、页面范围已经冻结，研发可以直接启动。

### 任务

- [x] 确认主文档以 [冻结评审版-总方案-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/冻结评审版-总方案-auth-sso-v1.0.md) 为准
- [x] 确认技术栈冻结
- [x] 确认 Better Auth 启用能力冻结
- [x] 确认 `portal_core / idp_auth / Redis` 数据落位冻结
- [x] 确认 `apps/portal` 和 `apps/idp` 页面范围冻结
- [x] 确认接口与数据库文档进入实施状态
- [x] **技术探针验证：Better Auth OAuth/OIDC Provider 满足 v1.0 需求** → [技术探针-Better-Auth-OIDC-Provider-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/技术探针-Better-Auth-OIDC-Provider-v1.0.md)

### 交付物

- 冻结版主文档
- 冻结版 PRD
- 冻结版技术选型
- 冻结版接口文档
- 冻结版数据库设计

### 验收标准

- 产品、后端、前端、测试对边界无高优先级争议
- v1.0 不做范围明确
- Better Auth 插件范围明确

---

## 3.2 阶段 B：工程初始化

### 目标

建立可开发的 monorepo 工程与基础运行环境。

### 任务

- 创建 `apps/portal`
- 创建 `apps/idp`
- 创建 `packages/contracts`
- 创建 `packages/config`
- 使用官方最新交互式 `create-next-app` 初始化 `apps/portal`
- 使用官方最新交互式 `create-next-app` 初始化 `apps/idp`
- 在 `apps/portal` 初始化 `shadcn/ui`
- 配置 `tailwindcss@latest`
- 建立 TypeScript strict
- 建立 ESLint
- 配置基础日志与错误处理
- 配置 env schema
- 配置本地开发 Docker 环境

### 交付物

- 可启动的 `apps/portal`
- 可启动的 `apps/idp`
- 可复用的 `packages/contracts`
- 可复用的 `packages/config`

### 验收标准

- Portal 可本地启动
- IdP 可本地启动
- 环境变量可切换
- 基础 lint / typecheck 可执行

---

## 3.3 阶段 C：数据层与基础设施

### 目标

建立 `portal_core` 与 Redis 运行基础，并为 Better Auth 生成 `idp_auth`。

### 任务

- 准备 PostgreSQL
- 准备 Redis
- 创建 `portal_core` schema
- 用 Drizzle 落业务主表
- 用 Drizzle 落关联表
- 用 Drizzle 落审计与登录日志表
- 创建唯一索引、部分唯一索引、外键、组合主键
- 创建 `idp_auth` schema
- 配置 Better Auth
- 执行 Better Auth 官方 schema 生成
- 执行 Better Auth migration
- 确认 Redis key 使用约定

### 重点表

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

### 重点 Redis Key

- `portal:sess:{sessionId}`
- `portal:user:sessions:{userId}`
- `portal:auth:txn:{state}`
- `idp:sess:{sessionId}`

### 交付物

- 可用的 `portal_core` migration
- Better Auth 生成的 `idp_auth` 表结构
- 可连接的 PostgreSQL / Redis 环境

### 验收标准

- 业务表结构可创建成功
- Better Auth 表结构可生成成功
- Redis 与 DB 连接正常
- 外键、索引、唯一约束符合数据库设计文档

---

## 3.4 阶段 D：Better Auth 集成

### 目标

完成 `apps/idp` 的认证能力集成与最小页面能力。

### 任务

- 配置 `BETTER_AUTH_SECRET`
- 配置 `BETTER_AUTH_URL`
- 配置 `DATABASE_URL`
- 配置 `REDIS_URL`
- 启用 Better Auth 核心认证能力
- 启用 `emailAndPassword`
- 启用 `@better-auth/oauth-provider`
- 启用 `jwt`
- 配置 `trustedOrigins`
- 配置安全 Cookie
- 配置 `jwks`
- 配置密码重置能力
- 配置 `sub -> user_identities.subject` 映射策略
- 实现登录页
- 实现认证确认页
- 实现错误页

### 交付物

- 可运行的 Better Auth 服务
- IdP 页面骨架
- `jwks` 能力

### 验收标准

- Better Auth 正常启动
- 登录页可访问
- OIDC 端点可访问
- JWT / `jwks` 配置可用

---

## 3.5 阶段 E：认证主链路

### 目标

打通 `Portal -> IdP -> Portal` 的完整登录链路。

### 任务

- 实现 `GET /api/auth/login`
- 生成 `state`
- 生成 `nonce`
- 生成 `code_verifier / code_challenge`
- 校验 `redirect`
- 写入 `portal:auth:txn:{state}`
- 跳转 `IdP /authorize`
- 实现 `GET /api/auth/callback`
- 调用 `POST /token`
- 校验 `state`
- 校验 `nonce`
- 校验 PKCE
- 解析 `id_token`
- 建立 `portal:sess:{sessionId}`
- 写入 `portal_session` Cookie
- 实现 `GET /api/me`

### 交付物

- Portal 登录可用
- `/api/me` 可返回当前登录态

### 验收标准

- 未登录访问 Portal 能跳转登录
- 登录完成后 `/api/me` 返回正确用户信息
- 刷新页面后登录态仍有效
- 错误 `state / code / nonce` 被正确拒绝

---

## 3.6 阶段 F：Session 与 Token 生命周期

### 目标

让 Portal Session、IdP Session、Token 刷新与超时规则稳定运行。

### 任务

- 实现 `idle timeout`
- 实现 `absolute timeout`
- 每次请求更新 `lastAccessAt`
- access token 即将过期时执行懒刷新
- refresh 失败时销毁 Portal Session
- 实现 `POST /api/auth/logout`
- 删除 `portal:sess:{sessionId}`
- 更新 `portal:user:sessions:{userId}`
- 删除 `idp:sess:{sessionId}`
- 清理 Portal Cookie
- 登录成功后重新签发 Session ID
- 支持后台强制下线

### 交付物

- 稳定的 Session 体系
- 可用的登出能力
- 可用的 Token 刷新能力

### 验收标准

- `idle timeout` 生效
- `absolute timeout` 生效
- refresh token 不延长 Portal Session 生命周期
- 登出后不能自动重新登录

---

## 3.7 阶段 G：权限中心与管理接口

### 目标

完成 RBAC 管理后端与权限上下文返回。

### 任务

- 实现用户管理接口
- 实现部门管理接口
- 实现角色管理接口
- 实现权限管理接口
- 实现 Client 管理接口
- 实现密码重置接口
- 实现强制下线接口
- 实现审计查询接口
- 实现权限码守卫
- 实现数据范围判定
- `/api/me` 返回角色、权限、菜单上下文

### 交付物

- 管理接口全套可调
- 权限上下文可返回

### 验收标准

- 无权限请求被正确拒绝
- 菜单展示与后端权限一致
- 写操作记录审计日志

---

## 3.8 阶段 H：Portal 页面开发

### 目标

完成 v1.0 范围内的 Portal 页面。

### 必有页面

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

### 可选页面

- 用户中心
- Session 失效统一提示页

### 任务

- 搭建页面路由
- 接入统一布局
- 接入权限显隐
- 接入统一错误态与空状态
- 联调管理接口

### 交付物

- 可用的 Portal 管理后台

### 验收标准

- 页面功能与接口契约一致
- 权限不足时页面正确处理
- 关键页面可联调完成

---

## 3.9 阶段 I：子应用接入

### 目标

至少完成一个子应用接入，验证 SSO 可用。

### 任务

- 注册测试 Client
- 配置合法 `redirect_uri`
- 验证 `authorize -> code -> token`
- 验证 `idp_session` 免登
- 验证 Portal 登出后重新发起认证必须重新登录
- 输出最小接入说明

### 交付物

- 1 个已接入的测试子应用
- 子应用接入说明

### 验收标准

- 子应用首登成功
- 二次访问可 SSO
- 登出后不能继续基于旧 IdP Session 免登

---

## 3.10 阶段 J：测试与安全加固

### 目标

确保认证链路、权限链路、安全链路都可回归。

### 测试任务

- 单元测试
- 集成测试
- E2E 测试
- 超时测试
- 异常场景测试
- 审计日志测试

### 安全任务

- 校验 `PKCE`
- 校验 `state`
- 校验 `nonce`
- 校验 Cookie 安全属性
- 校验 open redirect 风险
- 校验 Session fixation 风险
- 校验 CSRF / XSS 防护
- 校验 Token 不落浏览器
- 配置登录失败限制
- 配置异常登录告警

### 交付物

- 测试报告
- 安全检查清单

### 验收标准

- 无高危认证漏洞
- 核心链路回归通过
- 审计日志完整

---

## 3.11 阶段 K：上线准备与发布

### 目标

完成生产环境部署与上线前检查。

### 任务

- 配置生产 PostgreSQL / Redis
- 配置生产域名与 HTTPS
- 配置密钥注入
- 配置日志与监控
- 配置告警
- 准备 migration 发布顺序
- 准备回滚方案
- 准备上线检查单

### 交付物

- 生产环境部署方案
- 回滚方案
- 上线检查单

### 验收标准

- 上线流程可执行
- 回滚路径明确
- 监控与告警已配置

---

## 4. 每周建议安排

### 第 1 周

- 阶段 A
- 阶段 B
- 阶段 C
- 阶段 D 启动

### 第 2 周

- 完成阶段 D
- 阶段 E
- 阶段 F

### 第 3 周

- 阶段 G
- 阶段 H

### 第 4 周

- 阶段 I
- 阶段 J
- 阶段 K

---

## 5. 角色分工建议

- `产品`：边界冻结、页面验收、流程确认
- `前端`：Portal 页面、Portal 交互、Portal 权限显隐
- `Portal 后端`：BFF、Session、RBAC、管理接口、审计
- `认证后端`：Better Auth、OIDC、IdP Session、认证联动
- `测试`：认证、权限、超时、安全回归
- `运维`：环境、HTTPS、DB、Redis、日志与监控

---

## 6. 风险点

- Better Auth 插件变更会直接影响 `idp_auth` 结构
- 若 `Client` 管理边界重新变化，会影响 Portal / IdP 集成方式
- 若提前引入 MFA、Passkey、Organization，会显著放大范围
- 若 Portal 和 IdP Cookie / 域名策略不一致，会影响 SSO
- 若未严格校验 `redirect / state / nonce / PKCE`，存在明显安全风险

---

## 7. 完成标准

满足以下条件，可视为 v1.0 开发完成：

- Portal 登录、登出、`/api/me` 可用
- IdP OIDC 主链路可用
- Portal 登出后不会自动重新登录
- 用户、部门、角色、权限、Client 管理可用
- 至少 1 个子应用完成接入
- Session 生命周期符合设计
- 审计日志与登录日志可查
- 无高危安全问题阻塞上线

---

## 8. 一句话执行顺序

`先搭底座 -> 再通认证 -> 再稳 Session -> 再做权限中心 -> 再接子应用 -> 再做测试和上线。`
