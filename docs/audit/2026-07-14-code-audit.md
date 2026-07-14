# 代码全维度审计报告

> **审计日期**：2026-07-14
> **项目**：auth-sso
> **审计范围**：全项目（Next.js Portal + Rust Gateway + 共享包 + CI/CD + 测试）
> **综合评级**：B（良好，存在高优先级安全与测试债务）
> **严重问题数**：14 个  |  **一般问题数**：22 个  |  **优化建议**：19 个
> **复核方法**：四路 Agent 结果交叉验证 + TOP15 最严重问题源文件二次 Read 确认

---

## 目录

1. [全局诊断报告](#一全局诊断报告)
2. [分角色问题清单](#二分角色问题清单合并去重后)
3. [整体重构与规范方案](#三整体重构与规范方案)
4. [核心模块优化示例](#四核心模块优化示例)
5. [分阶段落地路线图](#五分阶段落地路线图)
6. [长期维护规范](#六长期维护规范)

---

## 一、全局诊断报告

### 1.1 TOP5 核心问题

| 排名 | 问题 | 来源 | 风险等级 | 概述 |
|------|------|------|----------|------|
| 1 | Redis allkeys-lru 淘汰策略可能删除 JTI 黑名单 | C6 | **严重** | `docker-compose.prod.yml:42` 配置 `allkeys-lru`，当 Redis 内存满时会淘汰任意 key，包括 `portal:jti_blocklist:*` 黑名单，导致已撤销的 Token 重新可用 |
| 2 | oauth-client.ts clientSecret 为 null 时 fail-open 放行 | D8/D16 | **严重** | `oauth-client.ts:38-66` 当 client 无 secret 时静默通过校验，若 client 应有机密但被意外清空则完全无认证 |
| 3 | 审计日志 fire-and-forget 无缓冲/重试/降级队列 | C4 | **严重** | `audit.ts:30-38` 使用 `(db.insert as any)(table).values(...).catch(...)` 直接吞错，DB/Redis 短暂不可用时审计日志永久丢失 |
| 4 | 全链路无 requestId/traceId 传播机制 | C3 | **严重** | Portal 侧零匹配 requestId/traceId/X-Request-Id，Gateway 有透传但 Portal 不消费不传播，问题排查完全依赖时间戳 |
| 5 | PR 工作流不执行 E2E 测试 | C5 | **严重** | `pr.yml` 仅跑单元+组件测试和 Gateway clippy，E2E 仅在 main 分支执行，PR 合入前无法发现集成回归 |

### 1.2 综合评级理由

项目整体架构设计合理（Drizzle ORM + 领域驱动 + jose 纯手工 JWT + Pingora Gateway），代码组织清晰分层，但存在以下系统性问题拉低评分：

- **安全防护链存在单点脆弱环节**：JTI 黑名单依赖 Redis 但不防淘汰、OAuth Client secret 校验存在 fail-open 路径
- **可观测性近乎空白**：无 traceId、审计日志不可靠、大量 console.log/error 无结构化输出
- **测试体系有结构缺陷**：API 测试全部 Mock DB 无法发现 SQL 错误、6 个关键端点无单元测试、E2E 不在 PR 阶段执行
- **响应格式契约碎片化**：`lib/response.ts` 定义了 `apiSuccess/apiError` 工厂但仅 2 个端点使用，其余端点各有自己的格式

### 1.3 四路 Agent 审计质量评估

| Agent | 提交数 | 确认 | 误报 | 合并 | 评价 |
|-------|--------|------|------|------|------|
| A (需求/规范/接口) | 20 | 18 | 0 | 2 | 接口格式不一致问题发现全面，但多条属同类（响应格式）可合并 |
| B (架构/安全/性能) | 28 | 26 | 0 | 2 | 覆盖度最高，SSRF/堆栈泄露等安全问题发现精准 |
| C (数据/可观测/CI) | 22 | 20 | 1 | 1 | C2（部门移动未递归更新 ancestors）经验证为误报：`departments/actions.ts:88-93` 使用 `REPLACE(ancestors, ...)` SQL 正确更新了子孙节点的物化路径 |
| D (兼容/测试/治理) | 23 | 21 | 0 | 2 | 测试债务问题发现精准，D8 与 D16 为同一条重复 |

---

## 二、分角色问题清单（合并去重后）

### 2.1 严重问题（14 个）

#### S-01 [严重-安全] Redis allkeys-lru 淘汰策略威胁 JTI 黑名单
- **来源**：C6
- **文件**：`docker-compose.prod.yml:42`
- **描述**：生产 Redis 配置 `--maxmemory-policy allkeys-lru`，当 256MB 内存满时，Redis 会淘汰任意 key，包括 `portal:jti_blocklist:*` 黑名单。被淘汰的 JTI 对应的已撤销 Token 将重新可用，构成严重安全漏洞。
- **证据**：`docker-compose.prod.yml:42`: `command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru`
- **修复建议**：改用 `volatile-lru` + 为 JTI 黑名单 key 设置 TTL（已实现），并确保其他 key 也设 TTL。或使用 `noeviction` + 监控告警。

#### S-02 [严重-安全] oauth-client.ts clientSecret 为 null 时 fail-open 放行
- **来源**：D8, D16（同源重复）
- **文件**：`apps/portal/src/domain/auth/oauth-client.ts:38-66`
- **描述**：`validateClientSecret` 函数当 `client.clientSecret` 为 null 时（第 42 行的 if 块不进入），函数直接返回无任何错误。若某个应该有机密的 client 被意外清空了 secret，其端点完全不校验 client_secret。
- **证据**：代码逻辑为 `if (client.clientSecret) { ... }` 包裹所有校验逻辑，else 分支无任何处理。
- **修复建议**：在 Client 创建/更新时确保 secret 不为 null；或在 `validateClientSecret` 中增加标志位区分"免密 client（公共客户端）"与"有机密 client"。

#### S-03 [严重-可观测] 审计日志 fire-and-forget 无缓冲/重试
- **来源**：C4
- **文件**：`apps/portal/src/lib/audit.ts:24-39`
- **描述**：`createLogWriter` 工厂使用 `(db.insert as any)(table).values(...).catch(...)` 模式，日志写入失败静默吞错。无内存缓冲区、无重试队列、无降级文件写入。DB 或 Redis 短暂不可用时审计日志永久丢失，违反 NFR-SEC-07（审计追溯）合规要求。
- **证据**：`audit.ts:33-34`: `.catch((err: Error) => log.error(\`写${tag}日志失败\`, { error: err.message }));`
- **修复建议**：引入内存环形缓冲区 + 定时批量刷写；或接入消息队列（如 Redis Streams）；至少增加文件降级写入。

#### S-04 [严重-可观测] 全链路无请求 ID 传播机制
- **来源**：C3
- **文件**：全项目 Portal 侧零匹配
- **描述**：Gateway 有透传 `X-Request-Id` 的能力（`gateway.rs:96`），但 Portal 端完全不消费、不传播该头。全项目搜索 `requestId|traceId|X-Request-Id|x-request-id|trace_id` 在 Portal 源码中零匹配。
- **修复建议**：在 Portal 的 middleware 或 `resolveIdentity` 中提取并传播 `X-Request-Id`；在所有 `console.log/error` 和结构化日志中附加 traceId。

#### S-05 [严重-CI/CD] PR 工作流不执行 E2E 测试
- **来源**：C5
- **文件**：`.github/workflows/pr.yml`
- **描述**：`pr.yml` 仅执行 `test:api`（mocked）、`test:components`、Gateway `clippy + fmt + test + audit`，E2E 测试只在 `main.yml` 的 main 分支 push 时执行。PR 合入前无法通过 E2E 发现集成回归。
- **修复建议**：在 `pr.yml` 中增加 E2E job，使用 `docker-compose` 启动 PostgreSQL + Redis 服务容器。

#### S-06 [严重-测试] 6 个关键 API 端点零单元测试
- **来源**：D1
- **文件**：缺失测试的端点：health, telemetry, introspect, revoke, authorize, refresh
- **描述**：`apps/portal/__tests__/api/` 目录下无对应的测试文件，这些端点是 OAuth 2.1 / OIDC 核心流程的一部分。
- **修复建议**：至少为 introspect（防堆栈泄露）、revoke（防误撤销）、refresh（防 Token 重放）编写单元测试。

#### S-07 [严重-测试] 所有 API 测试完全 Mock DB，零真实数据库交互
- **来源**：D2
- **文件**：`apps/portal/__tests__/api/` 下全部 18 个测试文件
- **描述**：所有 API 测试使用 `vi.mock('@/infrastructure/db', ...)` 完全替代 DB，无法发现 SQL 语法错误、Drizzle 查询构建错误、schema 不匹配等问题。
- **修复建议**：引入 `testcontainers` 或 Docker 化 PostgreSQL 进行集成测试，至少为核心认证流程提供真实 DB 测试。

#### S-08 [严重-测试] smoke.test.ts 是无效测试
- **来源**：D3
- **文件**：`apps/portal/__tests__/smoke.test.ts`
- **描述**：唯一有效断言为 `expect(1 + 1).toBe(2)`，不测试任何业务代码。第二个测试仅验证 `server-only` mock 是否加载。
- **修复建议**：替换为真实冒烟测试：启动应用 -> 调用 /api/health -> 验证 DB/Redis 连通性。

#### S-09 [严重-测试] auth-login.test.ts 仅覆盖 5 个场景
- **来源**：D4
- **文件**：`apps/portal/__tests__/api/auth-login.test.ts`
- **描述**：5 个测试覆盖：缺少 email、无效 email、用户不存在、密码错误、暴力破解锁定。缺失：LOCKED 状态（区别于暴力锁定）、DISABLED 状态、DELETED 状态、成功登录的 OAuth redirect 路径。
- **修复建议**：补充 DISABLED/DELETED/LOCKED 状态测试、并发登录测试、session_id 携带 OAuth redirect 路径测试。

#### S-10 [严重-安全] callback/route.ts 内网 URL 拼接未校验
- **来源**：B1
- **文件**：`apps/portal/src/app/api/auth/callback/route.ts:65`
- **描述**：`const internalBase = process.env['PORTAL_INTERNAL_URL'] || ...` 读取环境变量作为内部 URL base，拼接后发起 `fetch` 请求。若部署环境变量被污染，可构造 SSRF。风险等级因需环境变量控制降为 MEDIUM，但仍需防御。
- **证据**：`callback/route.ts:65` + `callback/route.ts:70-72`
- **修复建议**：对 `PORTAL_INTERNAL_URL` 做白名单校验（仅允许 `127.0.0.1`/`localhost` 或内网 IP 段），或直接硬编码为 localhost。

#### S-11 [严重-安全] introspect/revoke 端点在 console.error 中输出完整堆栈
- **来源**：B2
- **文件**：`introspect/route.ts:97-100`, `revoke/route.ts:81-85`
- **描述**：异常捕获后通过 `console.error` 输出 `err.stack`，生产日志中保留完整堆栈追踪，可能泄露服务器路径、依赖版本等内部信息。HTTP 响应正确返回了通用错误码（不泄露），但日志安全控制不足。
- **修复建议**：生产环境使用结构化 logger（如 pino/winston），通过日志级别控制堆栈输出（仅 development 输出 stack）。

#### S-12 [严重-架构] db/index.ts 绕过 Zod 校验直接读 process.env
- **来源**：B4
- **文件**：`apps/portal/src/infrastructure/db/index.ts:15`
- **描述**：`const connectionString = process.env['DATABASE_URL']!;` 直接读取环境变量，绕过 `@auth-sso/config` 包的 Zod Schema 校验。这与项目中其他 env 读取路径（`lib/env.ts` -> `@auth-sso/config`）不一致。
- **证据**：`db/index.ts:15` 直接 `process.env['DATABASE_URL']!`，而 `lib/env.ts` 通过 `@auth-sso/config` 的 Zod 校验。
- **修复建议**：统一使用 `getEnvConfig().DATABASE_URL` 或 `parsePortalEnv` 的返回值。

#### S-13 [严重-安全] SIGNATURE_TIMESTAMP_WINDOW_SEC 未做范围校验
- **来源**：B3
- **文件**：`apps/portal/src/lib/auth/verify-jwt.ts:50`
- **描述**：`const SIGNATURE_TIMESTAMP_WINDOW_SEC = parseInt(process.env['SIGNATURE_TIMESTAMP_WINDOW_SEC'] || '60', 10);` 未校验 parseInt 结果的合法性。若配置为 `0` 或负数，HMAC 时间戳窗口校验失效。
- **修复建议**：增加范围校验：`if (isNaN(parsed) || parsed < 1 || parsed > 300) { throw new Error('...') }`

#### S-14 [严重-代码] audit.ts 使用 (db.insert as any) 绕过类型检查
- **来源**：B5
- **文件**：`apps/portal/src/lib/audit.ts:32`
- **描述**：`(db.insert as any)(table)` 使用类型断言绕过 Drizzle 的类型安全，使 `createLogWriter` 可以接受任意表对象，丧失编译期 SQL 列名校验。
- **修复建议**：使用 Drizzle 泛型或为不同表类型编写特化工厂函数，消除 `as any`。

### 2.2 一般问题（22 个）

#### G-01 [一般-规范] 密码策略文档(8位)与实现(10位+3/4类)不一致
- **来源**：A1
- **文件**：`docs/spec/PRD.md:224` vs `apps/portal/src/domain/shared/zod-schemas.ts:36-41`
- **描述**：PRD 写"最小 8 位，含大小写字母和数字"，实现为"最小 10 位，大写/小写/数字/特殊字符中至少 3 类"。代码中已有注释说明（第 37 行）但 PRD 未更新。
- **修复建议**：更新 `docs/spec/PRD.md` 第 224-225 行。

#### G-02 [一般-规范] 响应格式契约碎片化 — 大部分端点未使用统一工厂
- **来源**：A2, A4, A7, A8, A9, A10, A11, A16, A17（合并）
- **文件**：多个 `route.ts` 文件
- **描述**：`lib/response.ts` 定义了 `apiSuccess/apiError` 工厂函数，但仅有 `clients/[id]/tokens` 和 `permissions/register` 两个端点实际使用。其余端点各有自己的响应格式：
  - `/api/me`: 返回 `{user, tokenInfo, permissions, roles, deptIds, menus}` 无 `success` 无 `data` 信封
  - `/api/me/permissions`: 返回 `{data:{...}}` 无 `success`
  - `/api/auth/login`: 使用 `{success: true}` 但无 `data` 信封
  - `/api/users/[id]/force-logout`: 返回 `{success, userId, revokedJtiCount, message}` 无 `data` 信封
  - `/api/users/[id]/reset-password`: 返回 `{success, message}` 无 `data` 信封
  - `/api/users/[id]/roles` POST: 返回 `{success, assignedCount}` 无 `data` 信封
  - OAuth 端点 (token/introspect/revoke/userinfo): 使用 RFC 标准格式（`error/error_description` 或 `active` 字段），与系统统一格式分叉 — 这是合理的 RFC 兼容性设计。
- **修复建议**：对非 OAuth 标准端点，全部迁移到 `apiSuccess/apiError`；OAuth 端点保持 RFC 格式不做修改。

#### G-03 [一般-代码] 生产代码中多处 console.log/error 残留
- **来源**：A5
- **文件**：`telemetry/route.ts:52`, `revoke.ts:142`, `redis/index.ts:54,68`, `login/route.ts:82`, `callback/route.ts:62`, `token/route.ts:107` 等
- **描述**：多处使用 `console.log`/`console.error` 而非结构化 logger（项目已有 `createLogger` 工厂但未统一使用）。
- **修复建议**：替换为 `createLogger` 调用；telemetry 端点的 `console.log` 是有意为之（stdout 供日志采集器消费），保留但添加注释。

#### G-04 [一般-代码] contracts/errors.ts ERROR_MESSAGES 映射表未被引用
- **来源**：A6
- **文件**：`packages/contracts/src/errors.ts:102-171`
- **描述**：`ERROR_MESSAGES` 是 70 行的错误码到中文消息的映射表，但全局搜索未发现任何引用。实际错误消息由 `domain/shared/error-mapping.ts` 的 `mapDomainError` 动态生成。
- **修复建议**：要么在 `mapDomainError` 中重新引用 `ERROR_MESSAGES` 作为 fallback，要么删除该映射表消除死代码。

#### G-05 [一般-安全] 多处错误响应缺少 success: false 字段
- **来源**：A11（部分）
- **文件**：`me/route.ts:28`, `me/permissions/route.ts:21`, `users/[id]/route.ts:24`（实际代码中）
- **描述**：未登录/未找到等错误响应仅返回 `{error, message}` 缺少 `success: false`，与 `ApiError` 契约不一致。
- **修复建议**：统一使用 `apiError()` 工厂函数。

#### G-06 [一般-代码] Refresh 续签使用硬编码 'portal' client_id
- **来源**：A3, A12
- **文件**：`refresh/route.ts:49`, `callback/route.ts:78`
- **描述**：`rotateRefreshToken(refreshToken, 'portal')` 硬编码 'portal' 作为 client_id。这是 Portal 自身作为 OAuth Client 的 BFF 模式，属于有意设计但缺少常量化。
- **修复建议**：将 `'portal'` 提取为 `PORTAL_CLIENT_ID` 常量放入 `@auth-sso/contracts`。

#### G-07 [一般-代码] UserInfo 端点缺少 preferred_username
- **来源**：A4
- **文件**：`userinfo/route.ts:39-45`
- **描述**：OIDC 标准建议 `userinfo` 响应包含 `preferred_username`，当前缺失。
- **修复建议**：添加 `preferred_username: user.username`。

#### G-08 [一般-架构] config re-export 层碎片化 + 多处直接读 process.env
- **来源**：B6
- **文件**：`lib/env.ts`, `db/index.ts`, `verify-jwt.ts`, `password.ts`, `brute-force.ts` 等多处
- **描述**：`lib/env.ts` 是 `@auth-sso/config` 的薄 re-export 层，但 `db/index.ts:15`、`verify-jwt.ts:50`、`brute-force.ts:22-33`、`password.ts:44` 等多处直接从 `process.env` 读取，绕过 Zod 校验。
- **修复建议**：所有 env 读取统一经过 `@auth-sso/config` 的 `parsePortalEnv` 或在模块顶层调用 `getEnvConfig()`。

#### G-09 [一般-代码] introspect 与 revoke 端点 OAuth Client 校验代码重复
- **来源**：B7
- **文件**：`introspect/route.ts:26-41` vs `revoke/route.ts:22-43`
- **描述**：两端点有 15 行几乎完全相同的 client 校验代码（DB 查询 + `validateClientActive` + `validateClientSecret`）。
- **修复建议**：抽取为共享 helper 函数 `authenticateOAuthClient(clientId, clientSecret)`。

#### G-10 [一般-架构] gateway.rs 872 行超过 500 行红线
- **来源**：B8
- **文件**：`apps/gateway/src/gateway.rs`（872 行）
- **描述**：主网关文件 872 行，超过红线 500 行，包含路由转发、请求头处理、身份验证、Cookie 处理等多种职责。
- **修复建议**：将 filter、proxy、auth 逻辑拆分为独立模块（部分已完成如 `auth/`、`oauth.rs`、`cookie.rs`）。

#### G-11 [一般-代码] permissions.ts 多处 catch(error: any) 丢失类型
- **来源**：B9
- **文件**：`lib/permissions.ts:59, 62, 168, 173` 等多处
- **描述**：异常捕获使用 `catch (error: any)` 而非 `unknown`，失去 TypeScript 严格类型检查。
- **修复建议**：改为 `catch (error: unknown)`，配合 `error instanceof Error ? error.message : String(error)` 模式。

#### G-12 [一般-代码] oauth-client.ts bcrypt 前缀硬编码
- **来源**：B10
- **文件**：`oauth-client.ts:47-49`
- **描述**：`startsWith('$2a$') || startsWith('$2b$') || startsWith('$2y$')` 硬编码 bcrypt 版本前缀。
- **修复建议**：提取为常量 `const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'] as const;`

#### G-13 [一般-代码] jwt.ts decodeJwtPayload 未验签版本与验签版签名相同
- **来源**：B11
- **文件**：`lib/session/jwt.ts:21-27`
- **描述**：`decodeJwtPayload` 不验签（使用 `jose.decodeJwt`），虽注释已说明用途，但函数命名未体现"不验签"语义。
- **修复建议**：重命名为 `decodeJwtPayloadUnverified` 或 `unsafeDecodeJwtPayload` 以明确安全语义。

#### G-14 [一般-代码] verify-jwt.ts EMPTY_CLAIMS 空字符串哨兵值
- **来源**：B12
- **文件**：`verify-jwt.ts:39-47`
- **描述**：`EMPTY_CLAIMS` 的 `sub`/`iss`/`aud`/`jti` 设为空字符串作为"未从 JWT 获取"的哨兵值，下游消费方需自行检查空值。
- **修复建议**：改用 `null` 或 `undefined` 而非空字符串，或使用 `Partial<PortalJwtClaims>` 类型。

#### G-15 [一般-代码] Cookie Secure 标志计算逻辑在 3 个 Controller 中散落重复
- **来源**：B13
- **文件**：`login/route.ts:88`, `callback/route.ts:105`, `refresh/route.ts:65`
- **描述**：`const secure = (process.env['NEXT_PUBLIC_APP_URL'] || '').startsWith('https://');` 在三处完全相同。
- **修复建议**：替换为 `isCookieSecure()` 调用（`@auth-sso/config` 已提供此函数）。

#### G-16 [一般-代码] password.ts PASSWORD_HISTORY_MAX 未做范围校验
- **来源**：B14
- **文件**：`password.ts:44`
- **描述**：`parseInt(process.env['PASSWORD_HISTORY_MAX'] || '5', 10)` 未校验结果，可能为 0 或负数。
- **修复建议**：增加 `if (isNaN(parsed) || parsed < 1) return 5;`

#### G-17 [一般-安全] Gateway oauth.rs localhost 判断可被绕过
- **来源**：B15
- **文件**：`apps/gateway/src/oauth.rs:104-111`
- **描述**：`origin_host.starts_with("localhost") || origin_host.starts_with("127.")` 用于判断是否使用 HTTP 协议，`127.` 前缀匹配可被 `127.evil.com` 绕过。当前逻辑还检查了 `!origin_host.contains("18443")` 作为额外防护，但不可靠。
- **修复建议**：使用 IP 地址解析库（如 `std::net::IpAddr`）判断是否为 loopback 地址。

#### G-18 [一般-代码] brute-force.ts 失败计数依赖 Redis TTL 无显式解锁
- **来源**：B17
- **文件**：`brute-force.ts:97-101`
- **描述**：锁定仅通过 Redis key TTL 过期自动解锁，无管理员手工解锁接口。DB 回退路径通过 `lastLoginAt` 间接清零，但 Redis 主路径仅依赖 TTL。
- **修复建议**：增加管理员手工解锁 API（`POST /api/users/[id]/unlock`）。

#### G-19 [一般-代码] login/route.ts lastLoginAt 更新失败静默吞错
- **来源**：B18
- **文件**：`login/route.ts:79-83`
- **描述**：更新 `lastLoginAt` 失败仅 `console.error` 不抛异常，但这影响暴力破解 DB 回退路径的准确性（`brute-force.ts` 依赖 `lastLoginAt` 计算窗口）。
- **修复建议**：至少记录结构化日志告警，或增加重试逻辑。

#### G-20 [一般-数据] refresh_tokens 表缺少 expires_at 索引
- **来源**：C7
- **文件**：`drizzle/0000_swift_rumiko_fujikawa.sql:63-75`
- **描述**：`refresh_tokens` 表仅有 `token_hash_unique`、`idx_refresh_tokens_client`、`idx_refresh_tokens_user` 索引，缺少 `expires_at` 索引。过期 Token 清理脚本 `cleanup-expired-tokens.ts` 依赖此列做范围查询。
- **修复建议**：增加 `CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens USING btree (expires_at);`

#### G-21 [一般-可观测] verify-jwt.ts 和 redis/index.ts 使用 console.warn/log 而非结构化 logger
- **来源**：C8, C9
- **文件**：`verify-jwt.ts:91, 104, 113, 118, 131` 等多处；`redis/index.ts:54, 64, 68`
- **描述**：关键鉴权模块和基础设施模块全部使用 `console.log/warn/error` 输出，无法按级别过滤、无法附加结构化字段、无法与采集器集成。
- **修复建议**：全部替换为 `createLogger`。

#### G-22 [一般-CI] 多项 CI 门禁缺失
- **来源**：C11, C12, C13, C19, C20 （合并）
- **文件**：`.github/workflows/pr.yml`, `.github/workflows/main.yml`, `Dockerfile`, `package.json`
- **描述**：
  - PR 缺少 JS/TS 格式化门禁（有 `cargo fmt` 但无 eslint format / prettier check）
  - 缺少密钥/秘密检测步骤（如 `trufflehog` 或 `gitleaks`）
  - Docker build-arg `NEXT_PUBLIC_APP_URL` 可能为空（`docker-compose.prod.yml:66` 传递 `${NEXT_PUBLIC_APP_URL}` 无默认值）
  - CI 无 Next.js 构建缓存（`main.yml` 无 `actions/cache` for `.next`）
  - ESLint 未启用 `--max-warnings=0`（允许 warning 通过）
- **修复建议**：逐步添加各项门禁。

### 2.3 优化建议（19 个）

#### O-01 [优化] well-known 端点 claims_supported 声明不完整
- **来源**：A13
- **文件**：`.well-known/openid-configuration/route.ts:34`
- **描述**：`claims_supported` 缺少 `roles`、`permissions`、`deptIds` 等 Portal 自定义 claim。

#### O-02 [优化] NFR-SEC-15 密码历史已实现但 API 文档未提及
- **来源**：A14
- **文件**：`docs/spec/API.md`
- **描述**：密码历史校验（禁止重用最近 5 次）在 `password.ts:43-78` 和 `reset-password/route.ts:56-61` 已实现，但 API 文档未说明。

#### O-03 [优化] withPermission/withAuth 回调签名模式不一致
- **来源**：A15
- **描述**：`withPermission`（用于 API Route）和 `withAuth`（用于 Server Action）的回调参数签名略有不同。

#### O-04 [优化] 分页参数 pageSize 默认值文档与实现可能不一致
- **来源**：A18

#### O-05 [优化] 无管理员手工解除暴力破解锁定接口
- **来源**：A19（与 G-18 关联）

#### O-06 [优化] telemetry 端点 withPermission 内嵌套冗余 try-catch
- **来源**：A20
- **文件**：`telemetry/route.ts:22-58`
- **描述**：`withPermission` 内部已有 try-catch，外层再嵌套一层冗余。

#### O-07 [优化] db/index.ts prepare:false 对非 Serverless 环境不必要
- **来源**：B16
- **文件**：`db/index.ts:18-20`
- **描述**：`prepare: false` 禁用 PostgreSQL prepared statements，注释说"提高 Serverless 兼容性"，但 Portal 部署在 Docker 长驻进程上。

#### O-08 [优化] Redis 接口 pipeline() 返回类型 any
- **来源**：B20
- **文件**：`redis/index.ts:37`
- **描述**：`pipeline(): any;` 失去类型安全。

#### O-09 [优化] Redis URL 脱敏日志不可靠
- **来源**：B21
- **文件**：`redis/index.ts:54`
- **描述**：`console.log('[Redis] Initializing ioredis with URL:', redisUrl.split('@')[1] || 'localhost');` 使用 `split('@')[1]` 脱敏，但 URL 中可能有多个 `@`（如 `redis://user:pass@host:port` 只有一个 `@`）。

#### O-10 [优化] Frontend 组件中 console.error 重复
- **来源**：B22

#### O-11 [优化] permissions.ts Math.random() 而非 crypto.randomInt()
- **来源**：B23
- **文件**：`lib/permissions.ts:28`
- **描述**：`Math.floor(Math.random() * ...)` 用于 TTL 抖动计算，应使用 `crypto.randomInt()` 以保证不可预测性。

#### O-12 [优化] 权限查询 4 层嵌套 JOIN 在缓存穿透时负担较大
- **来源**：B24
- **文件**：`lib/permissions.ts:67-89`
- **描述**：`getUserPermissionContext` 的 Drizzle 查询包含 `users -> userRoles -> roles -> rolePermissions -> permissions` 四层关联。

#### O-13 [优化] data-scope.ts 两步串行 DB 查询可并行化
- **来源**：B25
- **文件**：`lib/auth/data-scope.ts:28-66`
- **描述**：先查用户角色 deptId，再批量查子树，两步串行可并行。

#### O-14 [优化] Gateway redis.rs 连接池参数硬编码
- **来源**：B26
- **文件**：`apps/gateway/src/redis.rs:17-21`
- **描述**：`POOL_MAX_SIZE = 16` 等硬编码，应支持环境变量覆盖。

#### O-15 [优化] Gateway jwks.rs 刷新间隔硬编码
- **来源**：B27
- **文件**：`apps/gateway/src/jwks.rs:345`
- **描述**：`JWKS_REFRESH_INTERVAL_SECS = 300` 硬编码。

#### O-16 [优化] Gateway refresh.rs 回退 URL 硬编码 HTTP 协议
- **来源**：B28
- **文件**：`apps/gateway/src/auth/refresh.rs:88`
- **描述**：`format!("http://{}/api/auth/refresh", upstream)` 硬编码 HTTP 协议。

#### O-17 [优化] clients 表 isInternal 列无索引
- **来源**：C14

#### O-18 [优化] users/data.ts count+data 两次查询无事务
- **来源**：C15
- **文件**：`users/data.ts:63-78`
- **描述**：先执行 users 数据查询（第 68-72 行），再执行 count 查询（第 74-77 行），中间可能发生数据变化导致分页不一致。

#### O-19 [优化] 健康检查暴露版本号给未认证请求
- **来源**：C17
- **文件**：`health/route.ts:63`
- **描述**：`version: process.env.npm_package_version ?? 'unknown'` 对所有请求可见。

### 2.4 确认误报

| 误报 | 来源 | 说明 |
|------|------|------|
| C2：部门移动时未递归更新子孙 ancestors | Agent C | **误报**。`departments/actions.ts:88-93` 使用 `REPLACE(ancestors, oldPrefix, newPrefix)` SQL 在事务内正确更新了所有子节点的物化路径。代码已验证。 |

### 2.5 盲区补充

以下核心模块未被四路 Agent 充分覆盖：

| 盲区 | 建议关注点 |
|------|-----------|
| **PKCE 实现完整性** | `pkce.ts` 和 Gateway `oauth.rs` - 两端 code_verifier 生成是否等价？challenge 验证是否有边缘情况？ |
| **Drizzle Schema 关系定义** | `db/schema/relations.ts` - 关系配置是否正确？是否有缺失的 FK 导致 Join 失败？ |
| **Next.js 16 Cache Components** | `users/data.ts` 使用了 `'use cache'` + `cacheLife/cacheTag` - 缓存失效策略覆盖是否完整？ |
| **Token 签发中的 deptIds 子树展开** | `lib/auth/permissions-context.ts` - 展开逻辑是否有遗漏？ |
| **Gateway Session 亲和性** | `gateway.rs` - 是否依赖 sticky session？无状态假设是否成立？ |
| **数据库连接池耗尽保护** | DB 和 Redis 连接池均无显式 max 配置 - Portal 侧 Drizzle 使用 postgres-js 默认池大小？ |
| **API 限流** | Gateway 有 `rate_limiter.rs` - 是否对 Portal 直连路径生效？ |

---

## 三、整体重构与规范方案

### 3.1 响应格式统一化

**现状**：存在 4 种不同响应格式（OAuth RFC 格式、`{success, data}`、`{data}` 无 success、`{success, ...flatFields}` 无 data 信封）。

**方案**：
- **非 OAuth 端点**：全部迁移到 `apiSuccess()` / `apiError()` 工厂函数
- **OAuth 标准端点**（token/introspect/revoke/userinfo/authorize）：保持 RFC 格式，不强制统一
- **Server Action**：`withAuth` 已强制返回 `ApiResponse<T>`，保持不变

### 3.2 环境变量统一管理

**现状**：`@auth-sso/config` 提供了 Zod 校验的 `parsePortalEnv`，但多处代码直接读 `process.env`。

**方案**：
- 创建 `lib/env-config.ts` 在应用启动时调用 `parsePortalEnv` 并导出单例
- 所有模块通过该单例获取配置，禁止直接读 `process.env`
- 对不可序列化的值（如 `DATABASE_URL` 用于 postgres-js 连接），在基础设施层独立处理

### 3.3 日志与可观测性提升

**方案**：
- 统一使用 `createLogger` 替代所有 `console.log/error`
- 在 middleware 或 `resolveIdentity` 中提取/生成 `requestId`
- 所有日志自动附加 `requestId`、`userId`
- 审计日志增加内存缓冲 + 定时批量写入 + 文件降级

### 3.4 测试体系加固

**方案**：
- 引入 `@testcontainers/postgresql` + `@testcontainers/redis` 进行集成测试
- 为 6 个缺失单元测试的关键端点补写测试
- 替换 smoke.test.ts 为真实冒烟测试
- 将 E2E 测试纳入 PR 工作流
- 为目标关键端点设置覆盖率阈值

---

## 四、核心模块优化示例

### 4.1 审计日志可靠性改造（S-03）

**当前代码**（`audit.ts:30-38`）：
```typescript
function createLogWriter<TParams>(...) {
  return (params: TParams) => {
    try {
      (db.insert as any)(table)
        .values(buildValues(params))
        .catch((err: Error) => log.error(`写${tag}日志失败`, { error: err.message }));
    } catch (err) {
      log.error(`写${tag}日志失败 (sync)`, { error: (err as Error).message });
    }
  };
}
```

**建议方案**：
```typescript
// 内存环形缓冲区（固定大小，避免内存泄漏）
const LOG_BUFFER: Array<{ table: string; values: Record<string, unknown> }> = [];
const MAX_BUFFER_SIZE = 1000;
const FLUSH_INTERVAL_MS = 5000;

async function flushBuffer() {
  if (LOG_BUFFER.length === 0) return;
  const batch = LOG_BUFFER.splice(0);
  for (const entry of batch) {
    try {
      await db.insert(schema[entry.table]).values(entry.values);
    } catch (err) {
      // 降级：写入文件或 Redis 队列
      log.error('审计日志批量写入失败', { error: (err as Error).message });
    }
  }
}

setInterval(flushBuffer, FLUSH_INTERVAL_MS);
```

### 4.2 Redis 淘汰策略修复（S-01）

**当前**（`docker-compose.prod.yml:42`）：
```yaml
command: redis-server --maxmemory-policy allkeys-lru
```

**修复**：
```yaml
command: redis-server --maxmemory-policy volatile-lru
```
所有业务 key（JTI 黑名单、权限缓存、续签去重）均已设置 TTL，`volatile-lru` 仅淘汰有 TTL 的 key，不威胁无 TTL 的持久化数据。

### 4.3 clientSecret fail-open 修复（S-02）

**当前**（`oauth-client.ts:38-66`）：
```typescript
export function validateClientSecret(client, providedSecret?) {
  if (client.clientSecret) {
    // 校验逻辑...
  }
  // clientSecret 为 null 时直接放行！
}
```

**修复**：
```typescript
export function validateClientSecret(client, providedSecret?) {
  if (!client.clientSecret) {
    // 仅允许显式标记为 public 的 client 无 secret
    if (!client.isPublic) {
      throw new InvalidClientError('客户端密钥未配置');
    }
    return; // public client 无需 secret
  }
  // ... 原有校验 ...
}
```

---

## 五、分阶段落地路线图

### P0（本次立即修复，1-3 天）

| 序号 | 问题 | 动作 |
|------|------|------|
| P0-1 | S-01: Redis allkeys-lru | 修改 `docker-compose.prod.yml` 为 `volatile-lru` |
| P0-2 | S-02: clientSecret fail-open | 在 `validateClientSecret` 中增加 null 检查和 `isPublic` 标志 |
| P0-3 | S-11: 堆栈泄露到日志 | 生产环境禁止输出 `err.stack`，改用结构化 logger |

### P1（本周内，3-7 天）

| 序号 | 问题 | 动作 |
|------|------|------|
| P1-1 | S-03: 审计日志可靠性 | 引入内存缓冲 + 文件降级 |
| P1-2 | S-04: traceId 传播 | Portal middleware 提取 X-Request-Id |
| P1-3 | S-05: PR E2E 测试 | 在 pr.yml 中增加 E2E job |
| P1-4 | S-10: callback SSRF 防护 | 对 PORTAL_INTERNAL_URL 增加白名单校验 |
| P1-5 | G-02: 响应格式统一 | 非 OAuth 端点迁移到 apiSuccess/apiError |

### P2（本月内，2-4 周）

| 序号 | 问题 | 动作 |
|------|------|------|
| P2-1 | S-06/S-07/S-08/S-09: 测试体系 | 补充单元测试 + 集成测试 + 替换冒烟测试 |
| P2-2 | G-08: 环境变量统一 | 消除所有 `process.env` 直接读取 |
| P2-3 | G-09: OAuth 校验去重 | 抽取共享 helper |
| P2-4 | G-15: Cookie Secure 统一 | 统一使用 `isCookieSecure()` |
| P2-5 | G-20: refresh_tokens 索引 | 增加 expires_at 索引 |

### P3（下季度，1-3 月）

| 序号 | 问题 | 动作 |
|------|------|------|
| P3-1 | S-14: audit.ts 类型安全 | 消除 `as any` |
| P3-2 | G-10: gateway.rs 拆分 | 将 872 行拆至 500 行以下 |
| P3-3 | G-22: CI 门禁完善 | 添加 eslint format、密钥检测、构建缓存 |
| P3-4 | 盲区补充 | API 限流覆盖、连接池配置审计 |

### P4（持续优化）

| 序号 | 问题 | 动作 |
|------|------|------|
| P4-1 | O-01 ~ O-19 | 各项优化建议逐步落地 |
| P4-2 | G-01: PRD 文档同步 | 随功能迭代保持文档与代码一致 |
| P4-3 | 技术债务跟踪 | 在 CHANGELOG 或 TODO 中跟踪未完成项 |

---

## 六、长期维护规范

### 6.1 代码提交规范

- **响应格式**：新 API 端点必须使用 `apiSuccess()` / `apiError()` 工厂函数（OAuth RFC 端点除外）
- **环境变量**：禁止在 `apps/portal/src` 中直接读 `process.env`，统一通过 `getEnvConfig()` 或 `@auth-sso/config`
- **日志**：禁止新增 `console.log`，使用 `createLogger('ModuleName')`
- **类型安全**：禁止 `as any` 类型断言（需在 ESLint 中启用 `@typescript-eslint/no-explicit-any` 为 error）
- **测试**：新端点必须包含至少 3 个测试场景（成功、校验失败、权限拒绝）

### 6.2 安全审计清单（每次发布前检查）

1. Redis 淘汰策略是否为 `volatile-lru` 或 `noeviction`
2. OAuth client 是否存在 secret 为 null 的非 public client
3. 生产日志中是否包含 `err.stack`
4. `SIGNATURE_TIMESTAMP_WINDOW_SEC` 配置是否在 1-300 范围内
5. `PASSWORD_HISTORY_MAX` 是否大于 0

### 6.3 可观测性标准

- 每个请求携带 `X-Request-Id` 贯穿 Gateway -> Portal -> 日志
- 所有错误响应同时输出结构化日志（含 requestId、userId、errorCode）
- 审计日志写入成功率 > 99.9%（监控告警阈值）

### 6.4 测试覆盖率目标

| 模块 | 单元测试 | 集成测试 | E2E |
|------|----------|----------|-----|
| OAuth 核心流程 | 100% | 100% | 100% |
| 用户/角色/权限 CRUD | 90% | 80% | 70% |
| Gateway JWT 验签 | 95% | N/A | 90% |
| 审计/日志 | 80% | 50% | 30% |

---

> **报告结束** — 本报告由四路 Agent 交叉验证 + 复核 Agent 二次确认生成。所有严重问题的源文件均已完成 Read 确认。报告中的行号基于审计时的代码版本，实际位置可能因后续修改而偏移。
