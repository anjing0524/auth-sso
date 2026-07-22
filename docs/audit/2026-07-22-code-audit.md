# 代码全维度审计报告

> **审计日期**：2026-07-22
> **项目**：Auth-SSO（小企业统一门户 + SSO + 权限中心）
> **审计范围**：全项目
> **综合评级**：C+（亟需 P0 修复，存在 1 处高危安全漏洞 + 3 处严重架构缺陷）
> **严重问题数**：4 个  |  **一般问题数**：29 个  |  **优化建议**：28 个

## 1. 全局诊断报告

### 核心问题 TOP5（按严重程度排序）

| # | 问题 | 风险等级 | 文件位置 |
|---|------|---------|---------|
| **P0-1** | **JWKS 私钥明文存储在 PostgreSQL 数据库** — `private_key` 列为 `text` 类型，私钥以明文持久化。数据库泄露即全站 JWT 签名沦陷，攻击者可伪造任意令牌 | 🔴 严重 | `apps/portal/src/db/schema/auth.ts:119` |
| **P0-2** | **PR 工作流无真实数据库服务** — `pr.yml` 未配置 PostgreSQL 和 Redis 服务。API 测试在零数据库环境中运行（仅依赖 mock），`test:api` 和 `test:components` 无法验证 Drizzle schema 变更、DB 迁移兼容性和集成错误，只有合并到 main 后才暴露。JS 端仅有 `pnpm audit`（浅层），但 Rust 端已有 `cargo clippy + fmt + test + audit` 完整链路 | 🔴 严重 | `.github/workflows/pr.yml:42-46` |
| **P0-3** | **bcrypt.compareSync 阻塞 Node.js 事件循环** — `validateClientSecret` 在同步路径调用 `bcrypt.compareSync`（约 250ms/次）。高并发 OAuth token 交换时，事件循环被阻塞，导致吞吐量骤降和尾部延迟飙升 | 🔴 严重 | `apps/portal/src/domain/auth/oauth-client.ts:55` |
| **P0-4** | **Gateway Redis jti 黑名单 fail-open** — Redis 不可用时 jti 撤销检查降级放行，已吊销的 JWT 可绕过黑名单继续使用。攻击者利用 Redis DoS 即可复活被撤销的令牌 | 🔴 严重 | `apps/gateway/src/redis.rs:75-77` → `apps/gateway/src/auth/verify.rs:109` |
| **P1-5** | **passwordHistory 缺少 DB 层级约束** — `password_history` 列为 `text[]` 无长度上限，应用层 `PASSWORD_HISTORY_MAX` 默认 5，但 DB 不强制。bug 或直连 SQL 可导致数组无界增长 | ⚠️ 一般 | `apps/portal/src/db/schema/users.ts:39` |
| **P1-6** | **permissions/register route.ts 179 行控制器 + 无速率限制** — 单文件包含路由解析、鉴权、权限树扁平化、冲突检测、事务同步。无任何速率限制，攻击者可高频调用来回枚举权限结构 | ⚠️ 一般 | `apps/portal/src/app/api/permissions/register/route.ts` |
| **P1-7** | **telemetry 端点先解析 body 后鉴权** — `POST /api/telemetry` 在 `withPermission` 前先 `request.json()` 解析和 `TelemetrySchema.parse()`，无效请求体穿过权限层之前已被解析消耗，无意义增大攻击面 | ⚠️ 一般 | `apps/portal/src/app/api/telemetry/route.ts:22-50` |
| **P1-8** | **Domain 层直接访问 process.env** — `password.ts` 和 `brute-force.ts` 在模块顶层的 IIFE 中读取 `process.env`，非运行时注入，无法测试覆盖且配置无法热更新 | ⚠️ 一般 | `apps/portal/src/domain/auth/password.ts:18,44` / `apps/portal/src/lib/auth/brute-force.ts:23-33` |
| **P2-9** | **审计日志异步缓冲崩溃丢失** — `lib/audit.ts` 使用内存环形缓冲区 + 5 秒定时刷写。进程崩溃（OOM/SIGKILL）时最多丢失 5s 窗口的审计数据，违反「审计不可篡改、不丢失」的需求约束 | ⚠️ 一般 | `apps/portal/src/lib/audit.ts:29-56` |
| **P2-10** | **覆盖阈值软性不阻断 CI** — `main.yml` 覆盖率步骤使用 `if: always()`，不配置 `--fails-on` 等效机制，覆盖率跌至 90% 以下时 CI 仍然通过 | ⚠️ 一般 | `.github/workflows/main.yml:98-100` |

### 整体架构与代码质量评级

| 维度 | 评级 | 说明 |
|------|:----:|------|
| **架构设计** | **C** | 三层安全模型设计优秀，但分层执行不一致（domain 层混入 process.env/contracts 导入，Controller 179 行违法「单控制器 ≤20 行」红线）。分层架构有蓝图但未落地 |
| **API 标准化** | **C** | REST 端点响应格式不一致：部分直接返回数据，部分用 `{ error, message }`；users/roles 列表格式有 `{ data, pagination }` 和裸数组混合。缺少 OpenAPI 文档同步机制 |
| **代码质量** | **C+** | 多处非空断言 `!`、`as any` 类型逃逸、`Buffer` 使用、未穷举 switch。tree-utils.ts `Record<string,any>` 放弃类型安全。但 domain 层纯函数质量整体较好 |
| **数据建模** | **B-** | UUID PK + timestamptz 规范。问题：passwordHistory 无上限，user_roles 以 uniqueIndex 模拟主键，authorizationCodes 缺少 clientId 复合索引，ancestors LIKE 使用 ID 嵌入（UUID 场景安全但模式脆弱） |
| **测试质量** | **D** | client.test.ts 有代码但仅覆盖 4 条基本用例；缺少 domain/auth/ 中密码历史、PKCE 验证、Client Secret 兼容代码的测试；auth.test.ts 使用 SHA-256 hex 而非 bcrypt 哈希构造测试数据（与生产签名算法不匹配）；无性能/压力测试；`as any` 频繁使用 |
| **工程化（CI/CD）** | **D+** | PR 流程缺少 PostgreSQL/Redis 服务；覆盖率阈值不阻断；Gateway Dockerfile 未利用层缓存（伪 main.rs hack）；生产 docker-compose Portal 镜像使用 `:latest` 标签；JS 端无深度 SCA（Rust 端已有 `cargo audit`） |
| **安全性** | **C-** | P0 私钥明文存储 + bcrypt 同步阻塞 + jti fail-open 三大硬件缺陷。防暴力破解设计合理但 domain 层 process.env 导致测试不安全。权限注册无速率限制。telemetry 解析在鉴权前 |

### 推荐的核心优化方向与预期收益

1. **P0 紧急修复（私钥加密存储 + bcrypt 异步化 + jti fail-close）** — 消除 3 个可利用的安全通道，将攻击面从「数据库泄露 = 全站沦陷」降为「数据库泄露 = 加密数据」
2. **PR 工作流增加 PostgreSQL 服务** — 将集成问题发现提前到 PR 阶段，消除「合并到 main 才能发现迁移错误」的模式
3. **分层架构执行落地** — domain 层零基础设施依赖、Controller ≤20 行、写操作仅 Server Actions 而非 REST
4. **测试质量提升** — 补齐 domain 层覆盖率至 90%+，为 `oauth-code.ts` Temporal API 等易碎模块加测

## 2. 分角色问题清单

### 角色 1：需求工程 — 经审计发现 6 条

- ✅ `[角色1]` `apps/portal/src/**` — **NFR-SEC-16 会话并发控制未实现** — ⚠️ 一般 — 全系统 — 架构缺陷：用户无并发登录限制，需求矩阵标记为待实现但代码中无对应逻辑
- ✅ `[角色1]` `apps/portal/src/app/(dashboard)/**` — **菜单管理功能缺失** — ⚠️ 一般 — 管理端 — 权限管理有页面路由但菜单可视化编辑功能未完成
- ✅ `[角色1]` `apps/portal/src/app/api/auth/login/route.ts` — **登录响应缺少 `success` 字段** — 优化建议 — 登录 API — REST 端点按设计使用 HTTP 状态码即语义，但客户端对接方期望 `{ success: true }` 包裹
- ✅ `[角色1]` `apps/portal/src/app/api/auth/login/route.ts` — **密码策略防枚举设计不完善** — 优化建议 — 登录流程 — 登录失败返回「用户名或密码错误」统⼀文案已实现，但 LoginLogs 记录失败原因时可能泄露精确信息
- ✅ `[角色1]` `apps/portal/src/domain/auth/login.ts:22` — **UserAuthRow 暴露 passwordHash** — ⚠️ 一般 — 类型系统 — 领域层 `UserAuthRow` 接口包含 `passwordHash: string | null`，虽然 TypeScript 类型不运行时泄露，但增加意外泄露风险（注：上一轮审计标记为 `packages/contracts`，现接口已迁至 domain 层）
- ⚠️ `[角色1]` — **登录响应缺少 success 字段** — Agent 认为缺失 `success`，复核确认 REST 层有意设计（response.ts 注释说明「HTTP 200 即成功语义」），此为设计决策非缺陷。但 Server Action 使用 `ApiResponse<T>` 含 `success`，REST 与 RPC 双协议区分合理

### 角色 2：流程标准化 — 经审计发现 5 条

- ✅ `[角色2]` `docs/archive/TODOS-2026-06.md` — **TODO 无责任人** — 优化建议 — 项目管理 — TODO 清单无责任人/优先级/截止时间标记，无法驱动闭环
- ✅ `[角色2]` `apps/portal/src/app/api/auth/logout/route.ts` — **login_session Cookie 路径导致 Gateway 代理场景残留** — ⚠️ 一般 — 认证流程 — `login_session` Cookie Path 为 `/api/auth/oauth2/authorize`，logout 已实现 jti 撤销 + Cookie 清除（route.ts:62-68, 125）。但 Gateway 代理的 `/` 域下若浏览器带入了域名级 Cookie，仍可能残留。实评：浏览器 SameSite/Secure 行为正常时不会残留，属边界场景 |
- ✅ `[角色2]` `docs/spec/API.md` — **API 路径文档偏差（reset-password 端点缺失）** — 优化建议 — 文档 — API 文档未覆盖密码重置端点
- ✅ `[角色2]` `docs/spec/ARCHITECTURE.md` — **Gateway 注入头文档遗漏** — 优化建议 — 文档 — `X-Client-IP`、`X-Client-UA` 等 Gateway 注入请求头未在架构文档中声明
- ✅ `[角色2]` `apps/gateway/src/**` — **Gateway log_cookie_value 残留敏感数据** — 优化建议 — 安全日志 — Cookie 日志打印方式可能存在 token 明文泄露

### 角色 3：系统架构 — 经审计发现 5 条

- ✅ `[角色3]` `apps/gateway/src/jwks.rs:460` — **Gateway 使用 #[async_trait]** — 优化建议 — Gateway — Pingora 的 `BackgroundService` trait 实现要求 `#[async_trait]`，这是框架约束，非设计缺陷。但 AGENTS.md 明确「坚决避免 #[async_trait]」，建议 Pingora 兼容层封装或等待原生 async trait
- ✅ `[角色3]` `apps/portal/src/domain/auth/oauth-authorize.ts:11` — **domain 层导入 @auth-sso/contracts** — 优化建议 — 架构约束 — domain 层应零外部依赖。`ENTITY_ACTIVE` / `ADMIN_ROLE_CODES` 为纯常量，当前无运行时副作用，但如果 contracts 引入 DB 或框架依赖则越界
- ✅ `[角色3]` `apps/portal/src/domain/auth/oauth-code.ts:35-38` — **使用 Temporal API 兼容性风险** — ⚠️ 一般 — 领域层 — `Temporal.Instant` 和 `Temporal.Now` 尚在 TC39 Stage 3，Node.js 默认不启用 flag，存在运行时 `ReferenceError` 风险。需 `--experimental-temporal` 启动
- ✅ `[角色3]` `apps/portal/src/app/api/permissions/register/route.ts` — **permissions/register 179行控制器** — ⚠️ 一般 — 架构红线 — 违反「单控制器 ≤20 行」红线，179 行包含路由、鉴权、树展平、冲突检测、事务同步，应拆分为 data.ts + domain.ts + actions.ts
- ✅ `[角色3]` `apps/portal/src/lib/auth/brute-force.ts:23-33` — **brute-force.ts 模块级 process.env** — ⚠️ 一般 — 配置管理 — IIFE 模块级读取环境变量，不可 mock、不可热重载

### 角色 4：数据建模 — 经审计发现 5 条

- ✅ `[角色4]` `apps/portal/src/lib/auth/data-scope.ts:59` — **ancestors LIKE 误匹配风险** — 优化建议 — 数据访问 — `like(departments.ancestors, `${deptId}/%`)`。实评：deptId 为 UUID（`550e8400-e29b-...`），含 `/` 分隔符，UUID 前缀无歧义匹配。误匹配风险极低，但模式脆弱（若改为短编码则成立）
- ✅ `[角色4]` `apps/portal/src/db/schema/users.ts:39` — **passwordHistory 无上限约束** — ⚠️ 一般 — DB 建模 — `text('password_history').array()` 无 CHECK 约束，DB 不强制执行上限
- ✅ `[角色4]` `apps/portal/src/db/schema/users.ts:60-67` — **user_roles uniqueIndex 模拟主键** — ⚠️ 一般 — DB 建模 — 使用 `uniqueIndex` 而非复合 `primaryKey`，唯一约束等价于主键语义。虽然不是最佳实践，但有注释说明是有意选择
- ✅ `[角色4]` `apps/portal/src/db/schema/auth.ts:51-65` — **authorizationCodes 缺少复合索引** — ⚠️ 一般 — 查询性能 — 授权码查询路径：`WHERE code=?` 有唯一约束索引；token 交换后 `UPDATE used=true`。但 `SELECT ... WHERE client_id=?` 无索引，OAuth 统计查询可能全表扫描
- ✅ `[角色4]` `apps/portal/src/db/schema/auth.ts:114-122` — **jwks 私钥明文存储** — 🔴 严重 — 安全 — `privateKey: text('private_key').notNull()` 私钥以明文持久化

### 角色 5：API 标准化 — 经审计发现 4 条

- ✅ `[角色5]` `apps/portal/src/lib/response.ts:39-41` — **REST 响应无统一 success 包裹** — 优化建议 — API 规范 — 设计团队有意选择「HTTP 200 即成功语义」，但 REST 端点与 Server Actions 返回格式不一致，需查阅 `response.ts` 注释才能理解
- ✅ `[角色5]` `apps/portal/src/app/api/**/route.ts` — **pageSize 无上限检查** — ⚠️ 一般 — API 安全 — 列表 API 接受 client 传入 `pageSize` 但无上限（如 max 100），客户端请求 `pageSize=100000` 可触发 OOM 或大面积锁扫描
- ✅ `[角色5]` `apps/portal/src/app/api/users/**` / `apps/portal/src/app/api/roles/**` — **users/roles 列表响应格式不一致** — ⚠️ 一般 — API 规范 — 部分端点返回 `{ data, pagination }`，部分返回裸数组，未统一
- ✅ `[角色5]` `apps/portal/src/app/api/auth/logout/route.ts:143` — **登出 GET 请求 CSRF 风险** — ⚠️ 一般 — API 安全 — GET 方法支持 `back_url` 参数跳转，虽然 `safeRedirectPath` 做开放重定向防护，但 GET 登出符合 OAuth 2.0 RP-Initiated Logout 规范

### 角色 6：全链路实现 — 经审计发现 4 条

- ✅ `[角色6]` `packages/contracts/src/oidc.ts` — **OIDC REGISTER 端点未实现但常量存在** — 优化建议 — 全链路 — contracts 定义了 `REGISTER: 86400` 但 Portal 和 Gateway 均未实现 OIDC Register 端点
- ✅ `[角色6]` `apps/portal/src/app/api/auth/oauth2/authorize/route.ts` — **authorize 端点分支 A/B 流程分析完整** — 优化建议 — 认证流程 — 分支 A（带 session_id）和分支 B（无 session_id）流程有明确注释和路径分离
- ✅ `[角色6]` `apps/portal/src/app/api/auth/refresh/route.ts` — **refresh 端点 decodeJwtPayload 两次解析** — 优化建议 — 性能 — 同一请求中对 Refresh Token 调用两次 `decodeJwtPayload`（逻辑层 + 校验层）
- ✅ `[角色6]` `apps/portal/src/app/api/auth/logout/route.ts:142-157` — **logout GET back_url 验证** — 优化建议 — 安全 — `safeRedirectPath` 做了开放重定向防护，与 Portal 侧 `oauth-utils.ts` 等价实现

### 角色 7：Clean Code — 经审计发现 5 条

- ✅ `[角色7]` 多处文件 — **多处非空断言 `!`** — 优化建议 — 代码质量 — `oauth-client.ts:54` `client.clientSecret!`、`permissions/register/route.ts:81` `segs[1]!` 等，增加运行时 NPE 风险
- ✅ `[角色7]` `apps/portal/src/app/api/auth/refresh/route.ts` — **refresh skip 分支响应格式不一致** — 优化建议 — API 规范 — 续签 skip 时返回 `{ skipped: true }`，与正常续签 JSON 结构不同，增加 Gateway 解析复杂度
- ✅ `[角色7]` `apps/portal/src/app/api/auth/oauth2/token/route.ts` — **token route 分支未穷举** — 优化建议 — 代码质量 — `grant_type` switch 未穷举，隐性 fallthrough 可能
- ✅ `[角色7]` `apps/portal/src/domain/auth/oauth-code.ts:55` — **oauth-code.ts 使用 Buffer** — 优化建议 — 浏览器兼容 — domain 层使用 Node.js `Buffer`，纯函数领域层应使用 `btoa` 或 `Uint8Array` 数组实现 base64url
- ✅ `[角色7]` `apps/portal/src/app/api/auth/oauth2/token/route.ts` — **token route as 类型断言** — 优化建议 — 类型安全 — `as any` / `as SomeType` 断言破坏类型安全

### 角色 8：性能优化 — 经审计发现 3 条

- ✅ `[角色8]` `apps/portal/src/app/api/permissions/route.ts` — **权限全量加载 + 内存分页** — 优化建议 — 性能 — 权限列表从 DB 全量加载后在内存中分页，大量权限时浪费内存与带宽
- ✅ `[角色8]` 多处 — **resolveIdentity 重复调用** — 优化建议 — 性能 — 同一请求中多次解析 JWT 获取用户信息
- ✅ `[角色8]` `apps/portal/src/app/api/auth/login/route.ts` — **login await lastLoginAt** — 优化建议 — 性能 — 登录成功后在关键路径同步 `await` 写 `lastLoginAt` 后再返回，增加 1 RTT 延迟

### 角色 9：应用安全 — 经审计发现 5 条

- ✅ `[角色9]` `apps/portal/src/app/api/telemetry/route.ts:22-50` — **telemetry 先解析后鉴权** — ⚠️ 一般 — 攻击面 — Body 解析 + Zod schema 校验在 `withPermission` 鉴权之前，攻击者可发送任意 payload 消耗 CPU
- ✅ `[角色9]` `apps/portal/src/domain/auth/oauth-client.ts:55` — **bcrypt.compareSync 阻塞事件循环** — 🔴 严重 — 安全/性能 — 同步 bcrypt 阻塞
- ✅ `[角色9]` `apps/portal/src/lib/session/revoke.ts` — **revokeJti 返回值未校验** — 优化建议 — 安全 — jti 撤销写入不校验成功，若 Redis 故障则静默失败
- ✅ `[角色9]` `apps/gateway/src/redis.rs:75-77` / `apps/gateway/src/auth/verify.rs:67,109` — **Gateway jti fail-open 设计** — 🔴 严重 — 安全 — Redis 不可用时 jti 黑名单放行所有 token
- ✅ `[角色9]` `apps/portal/src/app/api/permissions/register/route.ts` — **permissions/register 无速率限制** — ⚠️ 一般 — 安全 — 权限注册端点无任何限流机制

### 角色 10：可观测性 — 经审计发现 4 条

- ✅ `[角色10]` 全系统 — **缺少链路追踪 Trace ID** — ⚠️ 一般 — 可观测性 — Gateway→Portal→DB 调用链路无统一 Trace ID，跨层问题排查困难
- ✅ `[角色10]` `apps/portal/src/lib/audit.ts:29-56` — **审计日志异步缓冲 crash 丢失数据** — ⚠️ 一般 — 审计合规 — 进程崩溃丢失 5s 窗口数据
- ✅ `[角色10]` `apps/portal/src/lib/audit.ts:32-45` — **审计日志 flush 失败静默吞异常** — 优化建议 — 可观测性 — 批量写入失败仅 `log.error()`，无告警/重试/死信队列
- ✅ `[角色10]` 全系统 — **缺少健康检查端点** — 优化建议 — 运维 — Gateway 和 Portal 均无 `/healthz` 端点，K8s / Docker 编排就绪探针无法准确判断服务状态
- ✅ `[角色10]` `apps/portal/src/app/api/telemetry/route.ts:64` — **server-logger 使用 console.error** — 优化建议 — 日志规范 — 部分模块使用 `console.log/error` 而非结构化日志框架

### 角色 11：兼容性 — 经审计发现 4 条

- ✅ `[角色11]` 全系统 — **缺少 API 版本控制** — 优化建议 — API 治理 — API 路由无 `/v1/` 前缀，未来向后兼容接口变更无版本协商能力
- ✅ `[角色11]` `apps/portal/src/domain/auth/oauth-client.ts:56-63` — **Client Secret SHA-256 兼容代码无移除计划** — 优化建议 — 技术债务 — SHA-256 遗留兼容代码无 sunset 日期，可能成为永久债务
- ✅ `[角色11]` `apps/gateway/Dockerfile:27` — **生产镜像使用 :latest 标签（runner stage）** — ⚠️ 一般 — 部署 — runner stage 使用 `FROM alpine:latest` 不可复现。builder stage 已使用 `rust:1.88-alpine`（固定版本）
- ✅ `[角色11]` `apps/portal/src/lib/env.ts` — **BASE_URL 生产环境缺省不报错** — 优化建议 — 部署 — `getAppBaseURL()` 在无有效环境变量时可能返回合理默认值而非快速失败

### 角色 12：测试质量 — 经审计发现 6 条

- ✅ `[角色12]` `apps/portal/__tests__/domain/client.test.ts` — **client.test.ts 覆盖不足** — ⚠️ 一般 — 测试 — 覆盖 `createClient`、`applyClientUpdate`、`toDomainClient` 基本路径，缺少无效输入/边界条件测试
- ✅ `[角色12]` `apps/portal/__tests__/domain/permission.test.ts` — **permission.test.ts 覆盖严重不足** — ⚠️ 一般 — 测试 — 权限领域层关键函数缺少完整覆盖
- ✅ `[角色12]` `apps/portal/__tests__/domain/auth.test.ts:145-147` — **auth.test.ts 测试与生产签名不匹配** — ⚠️ 一般 — 测试 — 使用 Node.js `crypto.createHash('sha256')` 构造 Client Secret hash，而生产数据使用 bcrypt。测试环境不匹配生产加密方案
- ✅ `[角色12]` `apps/portal/__tests__/smoke.test.ts` — **smoke.test.ts 测试框架能力** — 优化建议 — 测试 — Smoke 测试验证框架可用性
- ✅ `[角色12]` `apps/portal/__tests__/api/**` — **API 测试 mock 过多** — ⚠️ 一般 — 测试 — 大量 API 层测试 mock DB/Redis，实际集成测试仅在 main 分支 CI 中运行。pr.yml 无真实数据库
- ✅ `[角色12]` 多处 — **as any 频繁使用** — 优化建议 — 测试质量 — 测试代码中 `as any` 逃逸类型检查，降低测试可信度
- ⚠️ `[角色12]` — **无性能测试** — 复核确认：确实无压力/负载测试覆盖，但 P0 的 bcrypt.compareSync 问题就是性能低水位标记

### 角色 13：CI/CD — 经审计发现 5 条

- ✅ `[角色13]` `.github/workflows/pr.yml` — **PR 无真实数据库服务** — 🔴 严重 — CI/CD — 已确认，pr.yml 不含 PostgreSQL/Redis。集成测试仅在 main 分支 push 时执行
- ✅ `[角色13]` `.github/workflows/main.yml:98-100` — **覆盖率阈值软性不导致失败** — ⚠️ 一般 — CI/CD — `if: always()` 保证覆盖率步骤不会失败。另：`pnpm test:report --threshold 90` 实为需求追溯性报告（`@req` 标注匹配），非 vitest 代码覆盖率阈值
- ✅ `[角色13]` `apps/gateway/Dockerfile:16-24` — **Gateway Dockerfile 未利用层缓存** — ⚠️ 一般 — 构建效率 — 伪 main.rs hack 无法利用 Docker 层缓存加速依赖构建
- ✅ `[角色13]` `.github/workflows/pr.yml:33-34` — **JS 端无深度 SCA 工具集成** — 优化建议 — 安全 — `pnpm audit --prod --audit-level=high` 仅检查间接高危依赖，无 SBOM/源码级 SCA。Rust 端已有 `cargo audit`（pr.yml:85），JS 侧仍是盲区
- ✅ `[角色13]` `docker-compose.prod.yml:67` — **生产 docker-compose 使用 :latest 标签（Portal）** — ⚠️ 一般 — 部署 — Portal 使用 `auth-sso-portal:latest`，生产回滚无法锁定已知良好版本。Gateway 已移除 `image:` 字段，仅通过 `build:` 本地构建
- ⚠️ `[角色13]` — **PR 无真实数据库服务** — Agent 判定为严重。实评：pr.yml 运行 `pnpm test:api` 和 `pnpm test:components`，这些测试使用 mock DB。**确实严重** — 任何 Drizzle schema 变更、迁移脚本或 DB 查询重构均无法在 PR 阶段验证。建议 pr.yml 增加 PostgreSQL/Redis 服务和 `pnpm db:push` 步骤

### 角色 14：业务治理 — 经审计发现 5 条

- ✅ `[角色14]` `apps/portal/src/domain/auth/password.ts:44-49` — **Domain 层直接访问 process.env** — ⚠️ 一般 — 架构约束 — 已确认，domain 层 IIFE 读取 `PASSWORD_HISTORY_MAX` 环境变量
- ✅ `[角色14]` `apps/portal/src/app/api/permissions/register/route.ts:67-73` — **Hash Code 自定义实现** — 优化建议 — 数据一致性 — `getHashCode()` 实现 Java 风格 hash code，PostgreSQL advisory lock 使用自定义哈希而非标准 hash 函数
- ✅ `[角色14]` `apps/portal/src/domain/shared/tree-utils.ts:23` — **tree-utils.ts Record<string,any> 放弃类型安全** — ⚠️ 一般 — 类型系统 — `buildTree<T extends Record<string,any>>` 完全放弃键类型检查
- ✅ `[角色14]` `apps/portal/src/domain/auth/oauth-authorize.ts:36` — **validateAuthorization/checkUserClientAccess 命名混淆** — 优化建议 — 命名 — 两个函数名相似但职责不同：`checkUserClientAccess` 是子检查，`validateAuthorization` 是完整入口
- ✅ `[角色14]` `apps/portal/src/lib/auth/data-scope.ts:90` — **data-scope.ts 空数组歧义** — 优化建议 — 安全语义 — `canAccessDept` 在 `deptIds` 为空时返回 `false`，语义正确（无不可见的部门）

## 3. 整体重构与规范方案

### 分层架构调整建议

```
当前问题：
  domain/                ← 混入 process.env、contracts 导入
  lib/auth/              ← 纯函数 + DB 调用混搭（data-scope.ts）
  app/api/**/route.ts    ← 179 行巨型控制器

目标：
  domain/                ← 纯 TS 类型 + 纯函数，零 I/O、零 env、零框架
  domain/client/         ← 按业务域分包
  lib/auth/              ← 仅保留实用函数不为 domain 子包
  app/**/data.ts         ← "use cache" 只读查询
  app/**/actions.ts      ← Server Actions（≤20 行/函数）
  app/**/route.ts        ← 仅编排 + 调用 domain + 响应序列化
```

### 统一编码规范

1. **domain 层禁入清单**：`process.env`、`next/*`、`drizzle-orm`、`@auth-sso/contracts`（纯常量例外，但需显式标注 `/* pure-constant */`）、`Buffer`、`console.*`、`crypto.*`
2. **Controller ≤20 行**：超过时拆分到 `data.ts` / `actions.ts` / `domain/*`
3. **Config 统一注入**：`packages/config/` Zod schema 作为唯一配置源，domain 层接受 config 参数而非 `process.env`
4. **错误处理**：全部使用 `DomainError` → `mapDomainError()` 映射，禁止手写 `instanceof` 分支
5. **类型安全**：禁止 `as any`，禁止非空断言 `!`（除非 Zod 校验后且注释理由）

### 公共组件/工具抽取规划

| 组件 | 当前状态 | 目标 |
|------|---------|------|
| `tree-utils.ts` | `Record<string,any>` | 泛型约束 `T extends { id: string; parentId: string | null }` |
| `response.ts` | REST + SA 双格式 | 统一为 `ApiResponse<T>` 结构 |
| `hashCode` | Java 风格 handroll | 替换为 PostgreSQL `hashtext()` 或标准 hash 函数 |
| `audit.ts` | 内存缓冲 | 改用 PGPQ 或 Redis Stream 持久化缓冲 |
| `logger.ts` | 部分 `console.*` | 替换为统一的 `createLogger()` 全量覆盖 |

### 接口与数据统一标准

1. **REST 列表响应**：统一为 `{ data: T[], pagination: { page, pageSize, total, totalPages } }`
2. **REST 错误响应**：统一为 `{ error: string, message: string, details?: unknown }`
3. **Server Action 响应**：统一为 `ApiResponse<T> = ApiSuccess<T> | ApiError`
4. **pageSize 上限**：统一 **max 100**，由 `packages/config` 导出的 `PAGE_SIZE_MAX` 常量控制

## 4. 核心模块优化示例（代码对比）

### 示例 1：Domain 层 process.env → 配置注入

**优化前** (`apps/portal/src/domain/auth/password.ts:18`):
```typescript
const BCRYPT_ROUNDS = process.env['NODE_ENV'] === 'test' ? 4 : 12;
export const PASSWORD_HISTORY_MAX = (() => {
  const raw = process.env['PASSWORD_HISTORY_MAX'];
  const parsed = raw ? parseInt(raw, 10) : 5;
  if (isNaN(parsed) || parsed < 1) return 5;
  return parsed;
})();
```

**优化后**:
```typescript
// domain 层接受配置参数，纯函数
export interface PasswordConfig {
  bcryptRounds: number;
  passwordHistoryMax: number;
}

export const DEFAULT_PASSWORD_CONFIG: PasswordConfig = {
  bcryptRounds: 12,
  passwordHistoryMax: 5,
};

export async function hashPassword(raw: string, config: PasswordConfig): Promise<string> {
  return bcrypt.hash(raw, config.bcryptRounds);
}

export function pushPasswordHistory(
  prevHistory: string[] | null,
  oldHash: string,
  maxHistory: number,
): string[] {
  const next = prevHistory ? [oldHash, ...prevHistory] : [oldHash];
  return next.slice(0, maxHistory);
}
```

### 示例 2：permissions/register route.ts 巨型控制器 → 分层重构

**优化前**（179 行单文件，无速率限制）:
```
route.ts: POST handler
  ├── extractBasicAuth()
  ├── validateClientActive()
  ├── validateClientSecret()
  ├── flattenPermissions()
  ├── checkCodeConflicts()
  └── db.transaction: sync → insert/update/disable
```

**优化后**:
```
data.ts:       readClient(), readExistingPermissions()
domain.ts:     validatePermissionTree(), flattenPermissions(), 
               detectChanges(existing, incoming)
actions.ts:    registerPermissions(clientId, secret, tree) → Server Action
route.ts:      10 行编排
middleware:    rateLimit('permissions:register', { window: 60s, max: 10 })
```

### 示例 3：JWKS 私钥加密存储

**当前** (`apps/portal/src/db/schema/auth.ts:119`):
```typescript
publicKey: text('public_key').notNull(),
privateKey: text('private_key').notNull(),  // 明文私钥
```

**改进方案**:
```typescript
// 方案 A（推荐）：引入 Vault/KMS，私钥存内存不落盘
// - 启动时从环境变量 GATEWAY_SIGNING_KEY 读取
// - DB 仅存 kid + publicKey，私钥永不上库

// 方案 B（过渡）：AES-256-GCM 加密后入库
// encryption_key 来自环境变量 JWKS_ENCRYPTION_KEY（32 字节 hex）
publicKey: text('public_key').notNull(),
encryptedPrivateKey: text('encrypted_private_key').notNull(),  // AES-256-GCM 密文
```

## 5. 分阶段落地路线图

| 阶段 | 内容 | 预计工作量 | 风险点 | 可独立上线 |
|------|------|:--------:|--------|:--------:|
| **P0 紧急修复** | ① JWKS 私钥加密存储（至少 AES-256 加密后入库）② bcrypt.compareSync → compare async（await）③ pr.yml 添加 PostgreSQL+Redis 服务 ④ jti fail-open → fail-close（Redis 不可用时拒绝请求） | 3-4 天 | 私钥迁移需轮换所有已签发 JWT；fail-close 需评估 Redis 高可用方案 | ✅ |
| **P1 规范统一** | ① pageSize 上限约束统一 ② users/roles 列表格式统一 ③ REST 错误格式规范 ④ `tree-utils.ts` 类型约束加强 ⑤ `Buffer` → 浏览器兼容方案 | 3 天 | 列表格式变更影响前端消费者；需同步更新前端代码 | ✅ |
| **P2 公共抽取** | ① `audit.ts` 缓冲 + 重试 + 死信队列 ② `packages/config` Zod schema 统一配置管理 ③ domain 层 `process.env` → 配置注入 ④ hashcode 标准化 | 4-5 天 | 配置重构涉及全部 domain 函数签名变更；audit 缓冲改为持久化需要 Redis Stream | ⚠️ |
| **P3 架构优化** | ① `permissions/register` 拆分为 data + domain + actions ② Controller ≤20 行全面清理 ③ 全链路 Trace ID ④ 健康检查端点 | 5-6 天 | `/api/permissions/register` 接口变更需要下游子系统协调升级 | ⚠️ |
| **P4 细节清洁** | ① 非空断言 `!` 清理 ② `as any` 类型断言清理 ③ 未穷举 switch 补全 ④ `decodeJwtPayload` 重复调用优化 | 2-3 天 | 低风险，纯代码质量改善 | ✅ |
| **P5 质量防护** | ① domain 层测试覆盖率 ≥90% ② API 测试减少 mock，增加集成测试 ③ CI 覆盖率阈值硬阻断 ④ 性能测试（bcrypt/权限列表） ⑤ JS SCA 常态化（Rust 端 `cargo audit` 已接入 pr.yml） | 5 天 | 覆盖率的提升需要 infrastructure 投入（CI 数据库服务已由 P0 解决） | ✅ |

## 6. 长期维护规范

### 代码提交前自检清单

- [ ] 新增代码是否在正确的层级？domain 不含 `process.env`/`next/*`/DB
- [ ] Controller 函数是否 ≤20 行？如果更长，是否拆到了 domain/data/actions？
- [ ] 是否使用了非空断言 `!`、`as any`、`Buffer`？
- [ ] REST 端点响应格式是否与 `response.ts` 工厂函数一致？
- [ ] 分页 API 是否设置了 pageSize 上限（max 100）？
- [ ] 写操作是否用了 Server Actions？仅在跨域/OIDC 场景使用 route.ts
- [ ] 多表写入是否在 `db.transaction()` 中？
- [ ] 新 endpoint 是否需要速率限制？

### 架构约束红线

| 红线 | 违规后果 |
|------|---------|
| domain 层禁止 import DB / next / process.env | CI 自定义 ESLint 规则阻断 |
| Controller 函数 >20 行 | 代码审查强制驳回 |
| 新增 `as any` 类型断言 | 审查标注 required rework |
| 暴露私钥明文 / 密钥硬编码 | 安全告警 + 立即回滚 |
| 新增写操作使用 REST route.ts 而非 Server Action | 架构审查拒绝 |

### 团队编码公约

1. **类型为先**：`interface` 优先于 `type`，domain 层全部显式类型标注
2. **纯函数优先**：业务逻辑写在 domain 层的 `export function` 中，零 I/O
3. **错误可追踪**：全部使用 `DomainError` 子类 + `mapDomainError` 映射
4. **测试先行**：domain 层纯函数写单元测试（零 mock），集成测试写 `@vitest-environment node`
5. **文档同步**：API/架构变更必须在同一 PR 中更新 `docs/spec/` 对应文档
6. **版本锁定**：Docker 镜像禁止 `:latest`，Gateway 使用固定 digest 或 semver
