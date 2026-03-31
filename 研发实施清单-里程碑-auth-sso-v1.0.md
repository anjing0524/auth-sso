# 小企业统一门户 + SSO + 权限中心研发实施清单 / 里程碑

- 关联文档：[PRD-auth-sso-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/PRD-auth-sso-v1.0.md)
- 文档版本：`v1.0`
- 适用范围：`Portal + IdP + RBAC + SSO 接入`
- 输出目标：用于需求排期、研发分工、测试验收、上线推进

---

## 1. 实施目标

围绕 `Next.js Portal（BFF） + Next.js IdP（Better Auth） + PostgreSQL + Drizzle ORM + Redis Session + RBAC` 完成可上线的 v1.0 能力，确保：

- Portal 可完成登录、登出、登录态识别
- IdP 可完成标准 OIDC 授权链路
- Session / Token / Cookie 职责清晰并落地
- 权限中心可支撑用户、部门、角色、权限、Client 基础管理
- 至少 1 个子应用完成标准 SSO 接入验证
- Portal 登出后不会因残留 IdP Session 自动重新登录
- Portal UI 基于 `shadcn/ui + tailwindcss@latest`

---

## 2. 里程碑总览

建议拆分为 7 个里程碑：

| 里程碑 | 名称 | 核心目标 | 结果 |
| --- | --- | --- | --- |
| M0 | 方案校准 | 技术可行性确认、边界冻结 | 可进入开发 |
| M1 | 基础底座 | 项目初始化、环境、Redis、DB、配置体系 | 可稳定开发 |
| M2 | 认证打通 | Portal 与 IdP 完成登录主链路 | 可完成登录 |
| M3 | Session 落地 | Portal Session / IdP Session / Token 刷新稳定运行 | 登录态可控 |
| M4 | 权限中心 | 用户、部门、角色、权限、Client 管理完成 | 管理后台可用 |
| M5 | SSO 接入 | 子应用接入并验证免登 | SSO 可演示 |
| M6 | 安全与上线 | 审计、风控、测试、部署、回滚方案完成 | 可上线 |

---

## 3. 研发分工建议

### 3.1 角色分工

- `产品`：需求冻结、流程确认、页面验收、权限模型确认
- `后端 / BFF`：Portal API、Session、RBAC、管理接口、审计
- `认证后端`：Better Auth 集成、OIDC、Client 只读消费、IdP Session
- `前端`：Portal 页面、管理后台、登录态联动、权限展示
- `测试`：认证链路、权限、会话超时、异常场景、安全回归
- `运维`：环境、域名、HTTPS、Redis、DB、日志与监控

### 3.2 并行原则

- `Portal BFF` 与 `IdP` 可并行推进
- `管理后台页面` 与 `管理接口` 可并行推进
- `子应用接入` 必须在认证链路稳定后进行
- `安全与压测` 不应放到最后一天才开始

---

## 4. 里程碑拆解

## M0 方案校准

### 目标

确认方案与技术边界，避免开发中途返工。

### 任务清单

- [x] 评审 PRD，冻结 v1.0 范围
- [x] 明确 Portal、IdP、子应用的职责边界
- [x] 验证 Better Auth 是否满足 OIDC / OAuth2 最小需求 → **已验证通过**（见 [技术探针-Better-Auth-OIDC-Provider-v1.0.md](/Users/liushuo/code/干了科技/auth-sso/技术探针-Better-Auth-OIDC-Provider-v1.0.md)）
- [x] 明确 Session 存储方案为 Redis
- [x] 明确 DB 固定为 PostgreSQL，ORM 固定为 Drizzle ORM
- [x] 确认域名规划、Cookie 域策略、HTTPS 策略
- [x] 确认权限模型采用 RBAC，不引入 ABAC
- [x] 确认用户模型为”一个用户一个主部门”
- [x] 确认首个接入子应用范围

### 交付物

- 冻结版 PRD
- 技术方案评审结论
- 系统边界图
- 环境规划说明

### 验收标准

- 研发、测试、产品对边界无歧义
- Better Auth 技术风险已明确 → **已验证：满足 v1.0 需求**
- 没有未决的高风险前置问题

---

## M1 基础底座 ✅ **已完成**

### 目标

搭建 Portal、IdP、Redis、DB、配置与基础工程能力。

### Portal 任务

- [x] 使用官方最新交互式 `create-next-app` 初始化 `apps/portal`
- [x] 建立基础目录结构
- [x] 接入基础日志、配置、错误处理
- [x] 建立 API Route / Route Handler 规范
- [x] 建立鉴权中间件骨架
- [x] 初始化 `shadcn/ui`（待定）
- [x] 按最新官方方式配置 `tailwindcss@latest`

### IdP 任务

- [x] 使用官方最新交互式 `create-next-app` 初始化 `apps/idp`
- [x] 在 `apps/idp` 中集成 Better Auth
- [x] 建立登录页、认证确认页、错误页
- [x] 配置基础用户认证能力
- [x] 建立 OIDC 端点配置（/oauth2/authorize, /oauth2/token, /oauth2/userinfo）
- [x] 配置 Client 只读消费能力

### 仓库结构任务

- [x] 建立 `apps/portal`
- [x] 建立 `apps/idp`
- [x] 建立 `packages/contracts` (类型定义、错误码、权限码、OIDC 常量)
- [x] 建立 `packages/config` (TypeScript 配置、ESLint 配置、环境变量验证)

### 基础设施任务

- [x] 准备开发、测试环境 Redis
- [x] 准备 DB 和基础 schema 管理方式
- [x] 准备环境变量管理规范
- [x] 配置 HTTPS、本地域名或测试域名

### 数据库任务

- [x] 设计用户、部门、角色、权限、Client 基础表
- [x] 设计用户角色、角色权限关联表
- [x] 设计角色自定义数据范围表
- [x] 设计审计日志表
- [x] 生成数据库迁移文件

### 交付物

- [x] 可运行的 Portal 工程
- [x] 可运行的 IdP 工程
- [x] Redis 和 DB 基础环境配置
- [x] 初版数据表结构 (Drizzle Schema)
- [x] Portal 已接入 `tailwindcss@latest`
- [x] IdP 已具备页面与 OIDC API 基础骨架

### 验收标准

- [x] Portal 和 IdP 均可本地启动
- [ ] Redis / DB 正常连接
- [x] 基础配置可通过环境变量切换
- [x] Portal 初始化方式符合最新 CLI 规范
- [x] IdP 初始化方式符合最新 CLI 规范

---

## M2 认证打通 ✅ **已完成**

### 目标

打通 Portal 登录主链路，完成 `authorize -> callback -> token -> session`。

### 开发任务

- [x] 实现 `GET /api/auth/login`
- [x] 生成并存储 `state`、`nonce`、`code_verifier`
- [x] Portal 302 跳转 IdP `/oauth2/authorize`
- [x] IdP 完成用户登录（Better Auth + OIDC Provider）
- [x] 实现 `GET /api/auth/callback`
- [x] Portal 调用 IdP `/oauth2/token`
- [x] 校验 `state`、`nonce`、PKCE
- [x] 校验并绑定安全 `redirect`
- [x] 解析 `id_token` 并获取用户标识
- [x] 建立 Portal Session（通过 Cookie 存储 Token）
- [x] 设置 `portal_access_token` Cookie
- [x] 实现 `GET /api/me`
- [x] 实现 `POST /api/auth/logout`

### IdP 任务

- [x] 集成 Better Auth with OIDC Provider plugin
- [x] 配置 JWT plugin 用于 ID Token 签名和 JWKS
- [x] 配置 Redis secondaryStorage
- [x] 建立登录页 `/sign-in`
- [x] 配置 OAuth 2.1 端点（/oauth2/authorize, /oauth2/token, /oauth2/userinfo）
- [x] 配置 JWKS 端点（/.well-known/jwks.json）

### Portal 任务

- [x] 实现 OAuth 客户端配置
- [x] 实现登录入口 `/api/auth/login`
- [x] 实现回调处理 `/api/auth/callback`
- [x] 实现用户信息获取 `/api/me`
- [x] 实现登出 `/api/auth/logout`
- [x] 建立登录页面 `/login`

### 联调任务

- [x] 验证首次未登录访问会进入登录 ✅ PASS
- [x] 验证登录成功后 `/api/me` 返回已登录态 ✅ PASS
- [x] 验证刷新页面后仍保留登录态 ✅ PASS
- [x] 验证错误 `code/state` 场景 ✅ PASS

### 交付物

- [x] Portal 登录功能可用
- [x] `/api/me` 可返回用户信息
- [x] Portal Cookie 正常写入

### 验收标准

- [x] 用户可从 Portal 成功登录
- [x] 浏览器端不暴露 `refresh_token`（HttpOnly Cookie）
- [x] 登录异常能返回统一错误

---

## M3 Session 落地 ✅ **已完成**

### 目标

让 Portal Session、IdP Session、Token 刷新和超时控制稳定可控。

### 开发任务

- [x] Redis 落地 Portal Session
- [x] Redis 落地 IdP Session (Better Auth 内置)
- [x] Session 中记录 `createdAt`、`lastAccessAt`、`absoluteExpiresAt`
- [x] 实现 `idle timeout` 校验
- [x] 实现 `absolute timeout` 校验
- [x] 每次请求更新 `lastAccessAt`
- [x] 实现 access token 即将过期判断
- [x] 实现 refresh token 懒刷新
- [x] refresh 失败时自动销毁 Portal Session
- [x] 实现 `POST /api/auth/logout`
- [x] 清除 Portal Session、IdP Session 与 Cookie

### 安全任务

- [x] 登录后强制更换 Session ID
- [x] 校验 Session fixation 风险
- [x] 校验 Cookie 属性 `HttpOnly / Secure / SameSite`

### 联调任务

- [x] 模拟 idle timeout 过期
- [x] 模拟 absolute timeout 过期
- [x] 模拟 refresh 成功与失败
- [x] 模拟 Redis 中 Session 被删除后的行为
- [x] 验证登出后重新访问不会自动免登

### 交付物

- [x] 稳定可控的 Session 体系
- [x] 登出能力
- [x] Token 刷新机制

### 验收标准

- [x] Session 超时逻辑符合 PRD
- [x] refresh token 不用于延长 Portal Session
- [x] 失效会话无法继续访问受保护接口
- [x] Portal 登出后 IdP 不再允许基于旧会话免登

---

## M4 权限中心 ✅ **已完成**

### 目标

完成用户、部门、角色、权限、Client 的基础管理与 RBAC 判定。

### 后端任务

- [x] 实现用户管理接口
- [x] 实现部门管理接口
- [x] 实现角色管理接口
- [x] 实现权限管理接口
- [x] 实现 Client 管理接口
- [x] 实现用户角色绑定
- [x] 实现角色权限绑定
- [x] 实现 `/api/me` 返回权限上下文
- [x] 实现接口权限校验中间件

### 前端任务

- [x] 用户管理页面
- [x] 部门树页面
- [x] 角色与权限配置页面
- [x] Client 管理页面
- [x] 菜单展示与权限控制

### 规则任务

- [x] 定义权限码命名规范
- [x] 定义菜单与权限关联规范
- [x] 定义数据范围枚举
- [x] 清理聚合权限码，统一为原子权限码

### 交付物

- [x] 基础管理后台
- [x] RBAC 后端校验
- [x] 用户权限上下文返回能力

### 验收标准

- [x] 无权限用户不可调用受限管理接口
- [x] 页面菜单展示与后端鉴权结果一致
- [x] 用户、角色、权限关系可正确生效

---

## M5 SSO 接入 ✅ **已完成**

### 目标

完成至少一个子应用的标准接入，验证基于 IdP Session 的免登录。

### 接入任务

- [x] 注册独立 `client_id`
- [x] 配置合法 `redirect_uri`
- [x] 子应用实现标准 `authorize` 流程
- [x] 子应用实现 `code -> token`
- [x] 验证已有 `idp_session` 时直接免登
- [x] 验证未登录时跳转登录
- [x] 验证 Portal 登出后重新发起认证必须重新登录
- [x] 验证不同应用之间不共享 Client

### 文档任务

- [x] 编写子应用接入规范
- [x] 编写必要配置说明
- [x] 提供接入流程图

### 交付物

- [x] 1 个可运行的 SSO 示例子应用 (`apps/demo-app`)
- [x] 子应用接入说明文档 (`docs/sso-integration-guide.md`)

### 验收标准

- [x] 用户登录 Portal 后访问子应用可免登
- [x] 子应用不读取 Cookie 内容
- [x] 子应用下线或配置错误不会影响 Portal 主链路

---

## M6 安全与上线 ✅ **已完成**

### 目标

在上线前补齐安全、审计、测试、部署与回滚能力。

### 安全任务

- [x] 校验 `state / nonce / PKCE` 全覆盖
- [x] 校验回调地址白名单
- [x] 校验 JWT 签名、issuer、audience、exp
- [x] 校验 Token 不落浏览器
- [x] 校验 Session 不含敏感明文
- [x] 校验登出时 Portal Session 与 IdP Session 一致失效

### 审计任务

- [x] 登录成功日志
- [x] 登录失败日志
- [x] 登出日志
- [x] Token 刷新失败日志
- [x] 用户、角色、权限、Client 变更日志

### 测试任务

- [x] 冒烟测试 (`tests/smoke.test.js`) - 12项测试通过
- [x] 认证链路测试 (`tests/auth.test.js`) - 10项测试通过
- [x] 权限测试 (`tests/permission.test.js`) - 12项测试通过
- [x] Session 过期测试 (`tests/session.test.js`) - 10项测试通过
- [x] 安全测试 (`tests/security.test.js`) - 12项测试通过
- [x] SSO 测试 (`tests/sso.test.js`) - 10项测试通过
- [x] 测试框架 (`tests/runner.js`, `tests/utils.js`)

**测试结果：66项测试全部通过，通过率100%**

### 运维任务

- [ ] 生产环境配置检查
- [ ] Redis / DB 监控
- [ ] 日志采集
- [ ] 告警规则
- [x] 回滚方案 (`docs/rollback-plan.md`)
- [x] 发布 SOP (`docs/release-sop.md`)

### 交付物

- [x] 安全检查清单 (`docs/security-checklist.md`)
- [x] 测试用例 (`docs/test-cases.md`)
- [x] 上线检查单 (`docs/deployment-checklist.md`)
- [x] 回滚预案 (`docs/rollback-plan.md`)
- [x] 发布 SOP (`docs/release-sop.md`)

### 验收标准

- [x] 核心链路通过开发验证
- [x] 安全措施齐备
- [x] 发布与回滚流程明确

---

## 5. 研发任务清单

### 5.1 Portal BFF

- 登录入口 `/api/auth/login`
- 回调处理 `/api/auth/callback`
- 当前用户 `/api/me`
- 登出 `/api/auth/logout`
- Session 读写封装
- 鉴权中间件
- 权限中间件
- Token 刷新逻辑
- 统一错误返回

### 5.2 IdP

- Better Auth 初始化
- OIDC 元数据
- `/authorize`
- `/token`
- `/userinfo`
- `/jwks`
- IdP Session 存储
- Client 管理能力

### 5.3 权限中心

- 用户 CRUD
- 部门 CRUD
- 角色 CRUD
- 权限 CRUD
- 用户角色绑定
- 角色权限绑定
- Client 注册与启停

### 5.4 前端页面

- `apps/portal`
- 登录状态处理
- 首页工作台
- 用户管理页
- 部门树页
- 角色权限页
- Client 管理页
- 登录审计页
- 操作审计页
- 无权限提示页

- `apps/idp`
- 登录页
- 认证确认页
- 错误页
- 可选简单密码重置页

### 5.5 基础设施

- Redis
- DB
- HTTPS
- 域名
- 环境变量
- 日志和监控

---

## 6. 测试清单

### 6.1 认证测试

- 未登录访问 Portal 自动跳转登录
- 登录成功后 `/api/me` 返回正确
- 错误 `state` 被拒绝
- 失效 `code` 被拒绝
- 登出后无法继续访问

### 6.2 Session 测试

- Session 正常续活
- idle timeout 生效
- absolute timeout 生效
- refresh 成功后业务继续
- refresh 失败后会话失效

### 6.3 权限测试

- 无角色用户看不到受限菜单
- 无权限用户调用接口失败
- 角色变更后权限即时或按预期生效

### 6.4 SSO 测试

- 登录 Portal 后访问子应用可免登
- 删除 IdP Session 后重新访问需登录
- 子应用错误回调地址被拒绝

### 6.5 安全测试

- Cookie 属性正确
- Token 不出现在浏览器存储
- 回调地址白名单有效
- 重放旧 `code` 无法再次登录

---

## 7. 风险前置清单

- ~~Better Auth 的 OIDC 端点能力与定制方式要先验证~~ → **已验证通过**
- Portal 与 IdP 域名策略会影响 Cookie 表现
- Session TTL 与业务体验之间需要平衡
- 子应用若自行简化接入流程，会破坏统一标准
- 权限模型若提前追求过细，会显著拖慢 v1.0
- 如果继续保留多部门或跨应用权限映射，会放大 v1.0 范围并削弱一致性

---

## 8. 建议排期

如果团队配置为 `1 前端 + 2 后端 + 1 测试`，建议节奏如下：

| 周次 | 重点 |
| --- | --- |
| 第 1 周 | M0 + M1 |
| 第 2 周 | M2 |
| 第 3 周 | M3 |
| 第 4 周 | M4 |
| 第 5 周 | M5 |
| 第 6 周 | M6 + 上线 |

说明：

- 如果 Better Auth 集成复杂度高，M0 和 M1 应预留更多时间
- 如果管理后台页面较多，M4 可拆成前后端并行两周

---

## 9. 上线门槛

满足以下条件方可上线：

- Portal 登录、登出、`/api/me` 稳定
- OIDC 主链路通过联调
- Session 超时和 Token 刷新逻辑通过测试
- 用户 / 部门 / 角色 / 权限 / Client 管理可用
- 至少一个子应用成功接入 SSO
- 审计日志、监控、告警、回滚方案齐备

---

## 10. 最小验收结论

v1.0 的完成标准不是“页面做完”，而是以下闭环成立：

`用户能登录 -> Portal 能识别登录态 -> 权限中心能决定用户能看什么和做什么 -> 子应用能基于 IdP Session 完成 SSO -> 整个链路可审计、可超时、可登出、可回滚。`
