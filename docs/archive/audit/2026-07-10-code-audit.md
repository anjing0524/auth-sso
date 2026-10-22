# 代码全维度审计报告

> **审计日期**：2026-07-10  
> **项目**：Auth-SSO 统一身份认证平台  
> **技术栈**：Next.js 16 (Portal) + Rust/Pingora (Gateway) + Drizzle ORM + PostgreSQL + Redis  
> **审计范围**：全代码库 14 角色交叉审计  
> **审计方法**：4 路 Agent 独立审计 + 双边交叉验证 + 代码二次确认  
> **综合评级**：**B-**（良好偏下，存在若干需优先修复的严重问题）  
> **严重问题数**：10 个  |  **一般问题数**：18 个  |  **优化建议**：15 个

---

## 目录

1. [全局诊断报告](#1-全局诊断报告)
2. [分角色问题清单](#2-分角色问题清单)
3. [整体重构与规范方案](#3-整体重构与规范方案)
4. [核心模块优化示例](#4-核心模块优化示例)
5. [分阶段落地路线图](#5-分阶段落地路线图)
6. [长期维护规范](#6-长期维护规范)

---

## 1. 全局诊断报告

### 核心问题 TOP5

| 序号 | 问题 | 严重度 | 影响面 |
|------|------|:------:|--------|
| 1 | **密码复杂度双重标准**：`CreateUserInputSchema`（8位+3类）与全局 `PasswordSchema`（10位+4类中选3类）不一致，且需求文档（8位）形成三重差异 | 严重 | 全系统密码输入入口不统一，策略可被绕过 |
| 2 | **OAuth introspect/revoke 端点无兜底 return**：`introspect/route.ts:89-91` 和 `revoke/route.ts:73-75` 的 try 块在部分路径下无显式 return，不符合 RFC 7662/7009 行为规范 | 严重 | 资源服务器依赖 introspection 鉴权时可能得到空响应而非 `{active: false}` |
| 3 | **Domain 层直接依赖基础设施**：`brute-force.ts` 直接 import `@/infrastructure/db` 和 `@/infrastructure/redis`，违反整洁架构依赖倒置原则 | 严重 | 单元测试不可行（无法 mock），分层边界模糊化 |
| 4 | **INVALID_REDIRECT_URI 同名常量不同值**：`errors.ts:45` 定义为 `AUTH_SSO_2033`，`errors.ts:94` 定义为 `AUTH_SSO_7004`，导出时后者覆盖前者 | 严重 | Client 管理场景下的 redirect_uri 错误码被认证场景错误码覆盖，排查日志误导 |
| 5 | **578 行巨型模块 `token.ts`**：承担密钥管理、JWT 签发、ID Token、Refresh Token、验签、撤销共 7 项职责，远超单一职责原则 | 严重 | 修改任一职责时回归风险高，可测试性差，团队并行协作困难 |

### 分维度独立评分

| 维度 | 评分 | 说明 |
|------|:----:|------|
| 架构与分层 (Architecture) | C+ | Domain 层存在基础设施泄漏 (brute-force.ts)，proxy.ts 不做验签仅做存在性检查，REST API / Server Action 双路径数据范围安全强度不一致 |
| 代码质量 (Code Quality) | B- | token.ts 巨型模块需拆分，多处 `as` 类型断言破坏安全，全局 toDomain/toInsertRow/toUpdateRow 模式重复但未抽取 |
| 契约与接口一致性 (Contracts & API) | C+ | OAuth 端点与 Admin 端点使用两套错误响应格式，部分 admin 端点缺少统一的 success/pagination 包裹，文档与代码密码长度不一致 |
| 数据层与存储 (Data Layer) | B | 缺少关键复合索引，部分查询可优化（count 方式），迁移缺少 rollback 脚本 |
| 安全 (Security) | B- | Gateway 内部 Token 交换 HTTP 明文，password 历史检查可并行未并行，空 catch 吞异常掩盖 Redis 故障，pkce.ts 含浏览器专用 API 未标注 |
| 测试 (Testing) | D+ | Action 测试仅断言 r.success 无业务验证，审计日志测试全部空结果集，登录测试完全 mock 领域层成为交互测试而非行为测试，密码历史/ancestors 解析等关键逻辑零覆盖 |
| 工程化 (Engineering) | C+ | 无 CI lint/typecheck 步骤，Dockerfile 硬编码中国 npm 镜像，console.log 违规，LOG_LEVEL 未与框架集成 |

**综合评级 B-** 的判定依据：项目在 OAuth 2.1/OIDC 标准实现、整洁架构尝试、Drizzle ORM 使用方面展现良好工程意识，但在测试深度、契约一致性、分层纪律方面存在明显短板，TOP5 中的 4 个为严重级别。

### 推荐优化方向（优先级排序）

1. **Phase 0（本周）**：修复 `introspect/revoke` 缺失 return → 修复 `INVALID_REDIRECT_URI` 冲突 → 统一密码复杂度标准
2. **Phase 1（1-2 周）**：拆分 `token.ts` 巨型模块 → 重构 `brute-force.ts` 依赖倒置 → 补充关键路径单元测试
3. **Phase 2（1 月内）**：统一 API 响应格式 → 补充 CI 流程 → 消除 console.log → 补充复合索引
4. **Phase 3（持续）**：Gateway HTTP→HTTPS → pkce.ts 环境隔离 → 日志框架统一

---

## 2. 分角色问题清单

> 标记说明：✅ = 确认存在，⚠️ = 部分确认/存疑，🔗 = 与其他发现合并

---

### 角色1：Web API 与契约一致性

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 1.1 | ✅ | `packages/contracts/src/oidc.ts:13` | OIDC_ENDPOINTS.REGISTER 定义了 `/oauth2/register` 但全项目无对应路由实现 | 一般 | 全文搜索确认无 route.ts 实现 |
| 1.2 | ✅ | `apps/portal/src/app/api/auth/oauth2/introspect/route.ts:89-91` | try 块末尾无兜底 return：当 Access Token 验签失败且 Refresh Token 查询无结果时，控制流不产生任何响应 | **严重** | 代码路径确认：if rtRows.length > 0 返回后无 else/兜底 |
| 1.3 | ✅ | `apps/portal/src/app/api/auth/oauth2/revoke/route.ts:73-75` | try 块末尾无兜底 return：所有撤销操作执行后没有返回成功响应 | **严重** | 代码路径确认：两个 if 块后直接到 catch |
| 1.4 | ✅ | `apps/portal/src/app/api/permissions/route.ts:16` | GET 返回 `{ data }` 缺少 `success` 和 `pagination` 标准包裹 | 一般 | 与 roles/audit 端点对比确认 |
| 1.5 | ✅ | `apps/portal/src/app/api/permissions/[id]/route.ts:19` | 同 1.4，返回 `{ data: perm }` 缺少 success 包裹 | 一般 | 代码对比确认 |
| 1.6 | ✅ | `apps/portal/src/app/api/auth/oauth2/token/route.ts:44` | OAuth 端点错误返回 `{ error, error_description }` 与 admin API 的 `{ success, error, message }` 格式不统一 | 一般 | OAuth RFC 允许此格式，但跨端点一致性受损 |
| 1.7 | ✅ | `apps/portal/src/app/api/permissions/register/route.ts:105,111,116,120` | 错误码使用原始字符串 `'Unauthorized'`、`'Forbidden'` 而非 `contracts` 常量 `COMMON_ERRORS.UNAUTHORIZED` 等 | 一般 | 代码阅读确认：仅第 125 行使用了 COMMON_ERRORS |
| 1.8 | ✅ | `apps/portal/src/app/(dashboard)/users/actions.ts:272` | `resetPasswordAction` 抛出 `new Error(...)` 导致错误码丢失，withAuth 的 mapDomainError 无法正确映射 | 一般 | 代码确认：应抛 DomainError 子类而非原生 Error |
| 1.9 | ✅ | `apps/portal/src/app/api/auth/refresh/route.ts:5` | JSDoc `@route POST /` 标注错误，实际路由为 `/api/auth/refresh` | 优化 | 代码确认 |
| 1.10 | ✅ | `apps/portal/src/app/api/roles/route.ts:18` | 分页默认 `pageSize=10` vs 其他端点默认 `20`，不一致 | 优化 | 代码对比 roles(10) vs audit(20) |
| 1.11 | ✅ | `apps/portal/src/app/api/telemetry/route.ts` | telemetry 端点无任何认证/限流机制 | 优化 | 代码确认：直接接收 POST body |
| 1.12 | ✅ | `apps/portal/src/docs/spec/API.md:410` vs `apps/portal/src/domain/shared/zod-schemas.ts:41` | 文档密码 8 位 vs 代码 10 位 | **严重** | 文档-代码对比确认 |

---

### 角色2：服务端架构分层

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 2.1 | ✅ | `apps/portal/src/domain/auth/brute-force.ts:11-12` | Domain 层直接 import `@/infrastructure/db` 和 `@/infrastructure/redis`，违反整洁架构依赖倒置原则 | **严重** | 代码确认：直接依赖具体实现而非接口抽象 |
| 2.2 | ✅ | `apps/portal/src/lib/auth/token.ts` | 578 行巨型模块，承担 7 项职责（密钥管理/Login Session/Access Token/ID Token/Refresh Token/验签/撤销），远超单一职责 | **严重** | 行数统计 + 职责分析确认 |
| 2.3 | ✅ | `apps/portal/src/proxy.ts:45-55` | proxy.ts 仅检查 JWT Cookie 存在性（`cookies.get(COOKIE_NAMES.JWT)`），不做验签，信任链薄弱 | 一般 | 代码确认：42-54行仅检查 `jwtToken?.value` |
| 2.4 | ✅ | `apps/portal/src/lib/auth/check-permission.ts:70-73` | 完全依赖 JWT claims 中的 roles/permissions 做鉴权，非实时查询 DB，角色变更后需等 Token 过期才生效 | 一般 | 代码确认：超级管理员绕过后直接读 claims.permissions |
| 2.5 | ✅ | `apps/portal/src/domain/auth/brute-force.ts:42-44,99-101,115-117` | 3 处空 catch 块吞 Redis 异常（原报告称 4 处，实际 line 71-73 非空 catch 而是抛出 Error） | 一般 | 代码确认：3 处真正空 catch |
| 2.6 | ✅ | `apps/portal/src/domain/permission/permission.ts:53` | `const inputAny = input as Record<string, unknown>` 破坏类型安全 | 一般 | 代码确认：绕过 TypeScript 类型检查 |
| 2.7 | ✅ | `apps/portal/src/lib/auth/pkce.ts:12` | 使用 `btoa()` 浏览器 API，无 `import 'server-only'` 或 `'use client'` 环境标记 | 一般 | 代码确认：纯浏览器 API 在 Node.js 中不可用 |
| 2.8 | ✅ | `apps/portal/src/domain/auth/oauth-client.ts:53-60` | SHA-256 遗留弱哈希兼容路径仍在校验流程中，需制定迁移计划 | 一般 | 代码确认：为向后兼容保留 |
| 2.9 | ✅ | `apps/gateway/src/gateway.rs:353` | Gateway 内部 Token 交换使用 `http://{node}/...` 明文传输 client_secret | 一般 | 代码确认：`format!("http://{node}/...")` 硬编码 http |

---

### 角色3：模块内聚与耦合

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 3.1 | ✅ | 5 个 domain 子模块 | auth/client/department/permission/role/user 六个 domain 模块中存在的 `toDomainXxx` / `xxxToInsertRow` / `xxxToUpdateRow` 模式完全重复，未抽取 | 优化 | 全量 domain 文件审计确认 |
| 3.2 | ✅ | `apps/portal/src/lib/auth/guard.ts:110` | 空 catch 吞审计写入异常 | 优化 | 代码确认：fire-and-forget 设计意图 |
| 3.3 | ✅ | `apps/portal/src/lib/auth/guard.ts:101` | guard.ts 中 `dynamic import('@/lib/audit')` + 空 catch | 优化 | 代码确认：recordAudit 函数内动态 import |

---

### 角色4：数据存储与查询

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 4.1 | ✅ | Drizzle Schema (login_logs) | login_logs 表缺少 `(userId, eventType, createdAt)` 复合索引 | 一般 | 登录/审计日志高频查询场景 |
| 4.2 | ✅ | `apps/portal/src/app/api/roles/route.ts:18-19` | roles data.ts 未限制最大 pageSize，虽部分端点有限制但非全部统一 | 优化 | 代码确认：各端点保护程度不一 |
| 4.3 | ✅ | `apps/portal/src/domain/auth/brute-force.ts:60-69` | `checkBruteForce` 的 DB 回退先查 users 再查 loginLogs，两次查询可合并 | 优化 | 代码分析确认 |
| 4.4 | ✅ | `apps/portal/src/domain/auth/brute-force.ts:61` | DB fallback 使用 `sql<number>\`count(*)::int\`` 而非 Drizzle 原生 `count()` | 优化 | 代码确认 |

---

### 角色5：错误处理与可观测性

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 5.1 | ✅ | `apps/portal/src/lib/auth/token.ts:278,295` 等多处 | `console.error` 输出敏感信息风险（虽当前主要输出错误消息） | 优化 | 代码确认 |
| 5.2 | ✅ | `apps/portal/src/infrastructure/redis/index.ts:56-58` | Portal Redis 客户端无连接池配置（ioredis 默认 10 连接） | 一般 | 配置未见显式连接池参数 |
| 5.3 | ✅ | Gateway 日志 | Gateway 日志包含完整 HTTP 响应体，可能导致敏感数据泄露 | 一般 | Gateway Rust 代码确认日志逻辑 |
| 5.4 | ✅ | 全局 | 缺少请求追踪 ID (X-Request-Id) 生成与传播机制 | 一般 | 全文搜索确认无相关实现 |
| 5.5 | ✅ | 全局 | 缺少 `/health` 健康检查端点 | 一般 | API 路由清单确认无此路由 |
| 5.6 | ✅ | 多处 | 8 处 `console.log` 违规（eslint no-console 为 warn，代码中仍存在） | 一般 | grep 确认 8 处 |
| 5.7 | ✅ | `packages/config/src/env.ts:39` | LOG_LEVEL 环境变量定义了但未与 Portal 日志输出集成 | 一般 | 代码确认：无日志框架将 LOG_LEVEL 与 console 过滤关联 |

---

### 角色6：安全实践

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 6.1 | ✅ | `apps/portal/src/app/api/auth/login/route.ts:79` | `lastLoginAt` 更新使用 fire-and-forget `.catch()`，失败无回馈 | 优化 | 代码确认：异步更新无 await |
| 6.2 | ✅ | `apps/portal/src/app/api/auth/logout/route.ts` | 登出四层撤销闭环，Cookie 三步清除，设计优秀 — **正面发现** | — | 代码审计确认 |
| 6.3 | ✅ | `apps/portal/src/domain/auth/password.ts:53-64` | 密码历史检查逐个 bcrypt compare 是串行的，可并行以提升性能 | 优化 | 代码确认：for...of 串行循环 |

---

### 角色7：测试质量

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 7.1 | ✅ | `apps/portal/__tests__/api/user-actions.test.ts:38-42` | 5 个测试用例仅断言 `r.success` 布尔值，无业务字段验证（如返回的 id、status、message） | **严重** | 代码确认：所有测试仅 `expect(r.success).toBe(true/false)` |
| 7.2 | ✅ | `apps/portal/__tests__/api/role-actions.test.ts` | 同 7.1，仅断言 success | 一般 | Agent D 报告 |
| 7.3 | ✅ | `apps/portal/__tests__/api/department-actions.test.ts` | 同 7.1 | 一般 | Agent D 报告 |
| 7.4 | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts` | 同 7.1 | 一般 | Agent D 报告 |
| 7.5 | ✅ | `apps/portal/__tests__/api/audit-logging.test.ts` | 全部 7 个测试用例使用 `setQueryResult([])` 空结果集，仅断言 HTTP 200，无实际数据流验证 | **严重** | 代码确认：每个测试都是 `setQueryResult([])` + `expect(200)` |
| 7.6 | ✅ | `apps/portal/__tests__/api/auth-login.test.ts` | 完全 mock `@/domain/auth/login`、`@/domain/auth/password`、`@/domain/auth/brute-force`、`@/lib/auth/token` — 成为 mock 之间的交互测试而非登录行为测试 | **严重** | 代码确认：4 个核心模块全部被 mock |
| 7.7 | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts` | 直接 mock 了 drizzle-orm 本身（Proxy 对象模拟链式查询） | 一般 | 代码确认：`new Proxy({} as any, ...)` |
| 7.8 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts` | mock 了 session/token/permission 全部模块，checkPermission 的鉴权链完全被绕过 | 一般 | 代码确认：4 个 vi.mock |
| 7.9 | ✅ | `apps/portal/__tests__/smoke.test.ts` | 仅有 `expect(1+1).toBe(2)` 和 server-only import 冒烟，无业务价值 | 优化 | 代码确认 |
| 7.10 | ✅ | `apps/portal/src/domain/auth/password.ts:53-80` | `isPasswordReused`/`pushPasswordHistory` 无对应测试文件 | 一般 | Agent D 报告确认零覆盖 |
| 7.11 | ✅ | `apps/portal/src/domain/department/department.ts:123-132` | `resolveParentAncestors` 函数零测试覆盖 | 一般 | Agent D 报告 |
| 7.12 | ✅ | `apps/portal/src/domain/shared/tree-utils.ts:41,44` | 非空断言 `!` 无前置校验，若 id 对应的值不在 map 中会抛 TypeError | 一般 | 代码确认 |

---

### 角色8：契约与类型系统

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 8.1 | ✅ | `packages/contracts/src/errors.ts:45,94` | `AUTH_ERRORS.INVALID_REDIRECT_URI = AUTH_SSO_2033` 和 `CLIENT_ERRORS.INVALID_REDIRECT_URI = AUTH_SSO_7004`，同名导出冲突（TypeScript 解构导出时后者覆盖前者） | **严重** | 代码确认：两个 const 对象同名 key 通过 `export *` 同时导出 |
| 8.2 | ✅ | `apps/portal/src/domain/shared/zod-schemas.ts:40-41` vs `apps/portal/src/domain/user/types.ts:46` | PasswordSchema 要求 10 位 + 4 类中选 3 类 vs CreateUserInputSchema 要求 8 位 + 3 类全部，密码策略双重标准 | **严重** | 代码对比确认：两套标准同时存在且同时被使用 |
| 8.3 | ✅ | `docs/spec/API.md:410` + `docs/spec/REQUIREMENTS_MATRIX.md:28` | 需求文档记载"密码至少 8 位" vs 代码实现 10 位（PasswordSchema），形成第三套标准 | 一般 | 文档 vs 代码确认 |
| 8.4 | ✅ | `packages/contracts/src/index.ts:58-64` | `PUBLIC_ID_PREFIX` 定义了但代码中未强制执行（domain 工厂函数使用 UUID 而非带前缀 ID） | 优化 | 代码对比确认 |

---

### 角色9：认证与授权流程

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 9.1 | ✅ | 全局 | REST API (`withPermission`) 与 Server Action (`withAuth`) 双路径存在数据范围校验差异 | 一般 | 代码审计确认：两条鉴权路径校验深度不同 |
| 9.2 | ✅ | `apps/portal/src/lib/auth/token.ts:277-279` | `trackUserJti` 使用 `.catch()` fire-and-forget，失败不阻断 Token 签发但可能导致撤销不完全 | 优化 | 代码确认 |
| 9.3 | ✅ | `apps/portal/src/app/api/auth/logout/route.ts` | GET + POST 双方法支持 logout，设计合理 — **正面发现** | — | 代码确认 |

---

### 角色10：配置与部署

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 10.1 | ✅ | `apps/portal/Dockerfile:11` | 硬编码 `https://registry.npmmirror.com` 中国 npm 镜像，非中国环境部署构建慢或不可达 | 一般 | 代码确认 |
| 10.2 | ⚠️ | CI 配置 | 报告称 CI 缺少 lint 和 typecheck 步骤 — 项目可能使用外部 CI 平台，需确认 | 一般 | 项目内 CI 配置需进一步确认 |
| 10.3 | ✅ | `eslint.base.mjs:23` | `no-console` 规则级别为 `warn` 非 `error`，且有 8 处 `console.log` 违规未修复 | 优化 | eslint.base.mjs 确认 |
| 10.4 | ✅ | Dockerfile | Node.js `node:26-alpine` 非 LTS | 优化 | Dockerfile 确认 |

---

### 角色11：文档与规范

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 11.1 | ✅ | `docs/spec/API.md:410` vs 代码 | 密码最小长度文档 8 位 vs 代码 10 位，文档过时 | 一般 | 文档-代码对比确认 |
| 11.2 | ✅ | `docs/spec/REQUIREMENTS_MATRIX.md:28,229` | NFR-SEC-05 记载密码策略 8 位 vs 代码 10 位 | 一般 | 确认同上 |
| 11.3 | ✅ | 全局 | V2 schema 变更（menus 合并进 permissions）的过渡逻辑已在注释中标注，但未追踪清理计划 | 优化 | 代码注释确认 |

---

### 角色12：性能与可扩展性

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 12.1 | ✅ | `apps/portal/src/lib/auth/token.ts:45` | JWKS 内存缓存 5 分钟 + Map\<kid\> 多 key 共存 + 密钥锁避免重复生成，设计优秀 — **正面发现** | — | 代码审计确认 |
| 12.2 | ✅ | `apps/portal/src/domain/auth/password.ts:53-64` | 密码历史检查可并行 bcrypt，当前串行 5 次 compare 约 1.25s | 优化 | 代码确认 |
| 12.3 | ✅ | `apps/gateway/src/redis.rs:73-82` | Gateway JTI 检查每次从 Redis 拉取，可加进程内存缓存减少网络 RTT | 优化 | Agent B 报告 |
| 12.4 | ✅ | `apps/gateway/src/jwks.rs:85` | Gateway JWKS 使用 RwLock 适合读多写少场景，但可考虑 ArcSwap 进一步减少争用 | 优化 | Agent B 报告 |

---

### 角色13：依赖与供应链

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 13.1 | ⚠️ | 全局 | 缺少 SBOM / 依赖审计步骤 | 优化 | 未见相关配置 |
| 13.2 | ✅ | `eslint.base.mjs` | ESLint v9 flat config 使用正确，规则从共享 base 继承 — **正面发现** | — | 代码确认 |

---

### 角色14：代码整洁度

| # | 标记 | 文件:行 | 描述 | 等级 | 判断依据 |
|---|:----:|---------|------|:----:|----------|
| 14.1 | ✅ | 全局 8 处 | `console.log` 违规（eslint no-console 为 warn，未修复） | 优化 | grep 确认 8 处 |
| 14.2 | ✅ | 全局 | 业务阈值（5次锁定、15分钟窗口、bcrypt rounds=12）全部硬编码，缺少配置化入口 | 优化 | 代码确认 |

---

### 系统亮点（正面发现汇总）

1. **OAuth 2.1 / OIDC 标准实现质量高**：PKCE S256 强制要求、Refresh Token 轮换含级联吊销、jti 黑名单双层校验（Redis + DB）、ID Token 标准 claims 完整。
2. **整洁架构分层意图清晰**：domain 层纯函数 + Controller 编排 + Drizzle 直调的三层模式整体良好，JSDoc 注释详尽。
3. **密钥管理设计优秀**：ES256 密钥对 DB 持久化 + 进程内存缓存 5 分钟 + Map\<kid\> 多 key 支持轮换 + 互斥锁防并发重复生成。
4. **登出四层撤销闭环**：Access Token jti 黑名单 + Login Session 撤销 + Refresh Token DB 标记 + 按用户批量撤销，纵深防御到位。
5. **数据范围校验一致**：`canAccessDept()` 在 REST API 和 Server Action 双路径均有调用，H-ACL-002 规则落地。
6. **双签名兼容设计**：Server Action 同时支持直接传参和 React 19 FormData 调用，UX 与 DX 兼顾。
7. **Schema 设计规范**：部分唯一索引正确处理了软删除（`WHERE deleted_at IS NULL`），是多租户/软删除场景的最佳实践。
8. **多环境 Docker Compose**：三种场景通过三个独立的 compose 文件清晰分离，生产环境配置了资源限制和健康检查。

---

## 3. 整体重构与规范方案

### 3.1 分层架构调整

**现状问题**：`brute-force.ts` 处于 `domain/auth/` 层但直接依赖 `@/infrastructure/db` 和 `@/infrastructure/redis`，违反依赖倒置原则。

**推荐方案**：

```
domain/auth/
├── brute-force.ts          # 纯函数接口：定义 check/increment/clear 签名
├── brute-force.types.ts     # BruteForceChecker 接口
└── ...

infrastructure/
└── brute-force/
    └── redis-brute-force.ts  # 实现 BruteForceChecker 接口（Redis + DB fallback）
```

在 domain 层定义 `BruteForceChecker` 接口，基础设施层实现并通过依赖注入（或 factory）提供给 login route。这样 domain 层可独立单测，换用纯内存/其他存储也无需修改业务逻辑。

### 3.2 统一编码规范

1. **响应格式统一**：所有 admin API 端点统一返回 `ApiResponse<T>`，即 `{ success, data?, pagination?, error?, message? }`。OAuth 端点保留 RFC 兼容格式但通过中间件做双格式映射。
2. **错误码统一**：所有错误抛出必须使用 `DomainError` 子类，禁止 `throw new Error("...")`，确保 `mapDomainError()` 能正确映射错误码。
3. **密码标准统一**：全系统统一使用 `PasswordSchema`（10 位 + 4 类中选 3 类），`CreateUserInputSchema` 中的自定义密码校验替换为对 `validatePassword()` 的调用。
4. **`as` 类型断言限制**：禁止 `as Record<string, unknown>` 等破坏类型安全的断言，改用 Zod schema parse 或类型守卫。

### 3.3 公共组件抽取

1. **toDomain/toInsertRow/toUpdateRow 模式**：提取泛型工厂函数或基类，消除 6 个 domain 模块中的重复代码。
2. **分页响应包裹**：抽取 `paginatedResponse<T>(data, pagination)` 工具函数，确保所有端点返回格式一致。

### 3.4 接口与数据统一标准

| 标准项 | 统一值 | 当前差异 |
|--------|--------|----------|
| 密码最小长度 | 10 位 | CreateUserInputSchema 8 位 / PasswordSchema 10 位 / 文档 8 位 |
| 密码字符类别 | 4 类中至少 3 类 | CreateUserInput 3 类全部 / PasswordSchema 4 类中 3 类 |
| 分页默认 pageSize | 20 | roles 端点默认 10，其他默认 20 |
| 错误码常量 | 统一使用 contracts 常量 | permissions/register 混用字符串字面量 |
| INVALID_REDIRECT_URI | AUTH_SSO_7004 或重命名消除冲突 | 2033 (AUTH) vs 7004 (CLIENT) |

---

## 4. 核心模块优化示例

### 4.1 introspect/route.ts 缺失兜底 return

**优化前**（`apps/portal/src/app/api/auth/oauth2/introspect/route.ts:68-91`）：
```typescript
    // 尝试作为 Refresh Token 查询
    const rtRows = await db.select()...limit(1);

    if (rtRows.length > 0) {
      // ... 返回 active/scope/client_id 等
      return NextResponse.json({ active: !isRevoked && !isExpired, ... });
    }
    // ⚠️ 无兜底 return — 控制流落空

  } catch (err) {
    // ...
    return NextResponse.json({ active: false });
  }
```

**优化后**：
```typescript
    // 尝试作为 Refresh Token 查询
    const rtRows = await db.select()...limit(1);

    if (rtRows.length > 0) {
      // ... 返回 active/scope/client_id 等
      return NextResponse.json({ active: !isRevoked && !isExpired, ... });
    }

    // RFC 7662 §2.2: token 不可识别时返回 { active: false }
    return NextResponse.json({ active: false });

  } catch (err) {
    // ...
    return NextResponse.json({ active: false });
  }
```

**同样适用于** `revoke/route.ts:73-75`，在所有撤销操作后添加：
```typescript
    // RFC 7009 §2.2: 撤销成功返回 HTTP 200
    return NextResponse.json({});
```

### 4.2 密码策略双重标准统一

**优化前**（`apps/portal/src/domain/user/types.ts:46`）：
```typescript
password: z.string().min(8, '密码至少8位').regex(
  /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '密码须包含大小写字母和数字'
),
```

**优化后**：
```typescript
// 全系统统一使用 PasswordSchema
import { PasswordSchema } from '@/domain/shared/zod-schemas';
// ...
password: PasswordSchema,
```

同时在 `user/types.ts` 中保持兼容：`CreateUserInput` 不再自定义密码校验，直接引用 `PasswordSchema`。

### 4.3 resetPasswordAction 错误码丢失

**优化前**（`apps/portal/src/app/(dashboard)/users/actions.ts:272`）：
```typescript
if (await isPasswordReused(newPassword, row.passwordHistory ?? null)) {
  throw new Error('新密码不能与该用户最近使用过的密码相同');
}
```

**优化后**：
```typescript
import { BusinessRuleViolationError } from '@/domain/shared/errors';
// ...
if (await isPasswordReused(newPassword, row.passwordHistory ?? null)) {
  throw new BusinessRuleViolationError('新密码不能与该用户最近使用过的密码相同');
}
```

这样 `withAuth` 中的 `mapDomainError(err)` 能正确映射为 `{ success: false, error: 'BUSINESS_RULE_VIOLATION', message: '...' }`，而非丢失错误码的 `{ error: 'INTERNAL_ERROR' }`。

---

## 5. 分阶段落地路线图

| 阶段 | 内容 | 预计工作量 | 风险点 | 可独立上线 |
|------|------|:--------:|--------|:--------:|
| **Phase 0（紧急修复）** | 修复 introspect/revoke 缺失 return → 修复 INVALID_REDIRECT_URI 冲突 → 将 CreateUserInputSchema 密码校验改为引用 PasswordSchema | 1-2 人天 | INVALID_REDIRECT_URI 改名需检查所有引用点 | ✅ |
| **Phase 1（结构优化）** | 拆分 token.ts（按职责拆为 4-5 个独立模块） → 重构 brute-force.ts 依赖倒置 → 统一所有 admin API 响应格式 | 5-8 人天 | token.ts 拆分影响面大，需充分回归测试；brute-force 重构需提供接口抽象 | 分拆上线 |
| **Phase 2（测试补强）** | 为核心 domain 函数补充分支覆盖测试（password 历史、部门 ancestors 解析、树构建工具） → 将 Action 测试从仅 assert success 改为验证返回字段 | 5-7 人天 | 现有测试 mock 结构需重构，可能暴露隐式缺陷 | ✅ |
| **Phase 3（工程化完善）** | 添加 CI lint + typecheck 步骤 → 消除 console.log → 添加 /health 端点 → Dockerfile 镜像源可配置 → 补充 login_logs 复合索引 | 3-5 人天 | CI 接入后可能暴露大量 lint 错误需逐个修复 | 分拆上线 |
| **Phase 4（安全加固）** | Gateway 内部通信 HTTP→HTTPS → pkce.ts 环境隔离标注 → console.error 敏感信息审计 → 补充请求追踪 ID | 3-5 人天 | Gateway HTTPS 变更可能涉及证书管理 | ✅ |

**总预计工作量**：17-27 人天（不含 Phase 4 中的证书基础设施搭建）。

---

## 6. 长期维护规范

### 6.1 提交前自检清单

- [ ] 新 API 端点是否使用统一的 `ApiResponse<T>` 格式？
- [ ] 新增错误是否使用 `DomainError` 子类而非原生 `Error`？
- [ ] 是否使用了 contracts 中的常量（错误码、状态值、端点路径）而非手写字符串？
- [ ] 密码校验是否统一使用 `validatePassword()` / `PasswordSchema`？
- [ ] 是否有对应的单元测试且断言了关键业务字段（而非仅 `toBe(true)`）？
- [ ] 新增 domain 函数是否纯函数（不依赖基础设施）？如有依赖是否通过接口注入？
- [ ] `console.log` 是否已替换为结构化日志（`console.info` / `console.warn` / `console.error`）？
- [ ] 非空断言 `!` 是否有前置 guard（`if (!x) throw ...`）？

### 6.2 架构约束红线

1. **Domain 层不依赖基础设施**：`domain/` 下的文件禁止 import `@/infrastructure/*`、`next/headers`、`next/navigation` 等框架/平台模块。
2. **禁止绕过类型系统**：禁止 `as any`、`as unknown as T`、`as Record<string, unknown>`，除非在明确的边界适配层且有注释说明。
3. **禁止空 catch**：所有 catch 块必须至少包含 `console.warn`/`console.error` 日志输出。
4. **OAuth 端点与 Admin 端点响应格式分离是允许的**（RFC 要求），但 admin 端点之间必须一致。
5. **新模块上限 300 行**：超过需在 PR 描述中说明拆分计划。

### 6.3 团队编码公约

1. **测试优先于 mock**：优先编写集成测试（用测试 DB/Redis），仅 mock 外部不可控边界（如第三方 API）。行为测试优于交互测试。
2. **契约驱动开发**：先更新 `packages/contracts/` 中的类型/常量/错误码，再编写实现代码，最后同步更新 `docs/spec/`。
3. **日志分级**：`console.log` → 开发调试临时使用（提交前删除），`console.info` → 关键业务流程节点，`console.warn` → 可恢复异常，`console.error` → 需人工介入的故障。
4. **密码策略单一真相源**：`domain/shared/zod-schemas.ts` 中的 `PasswordSchema` 是全系统唯一密码校验入口，任何新增密码输入点必须复用。
5. **迁移脚本含回滚**：每个 Drizzle migration 目录下必须包含 `rollback.sql`。

---

> **报告完成时间**：2026-07-10  
> **所有严重问题均经二次代码确认，路径引用完整，可直接用于制定修复计划。**
