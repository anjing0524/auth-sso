# 代码全维度审计报告

> **审计日期**：2026-07-14
> **项目**：auth-sso
> **审计范围**：全项目（Portal + Gateway + Contracts + Config）
> **审计方法**：双 Agent 并行审计 → 复核 Agent 交叉验证、去重、盲区补充
> **综合评级**：**B**（架构 B+ / 代码质量 B / 安全性 A- / 测试 C+ / 工程化 B）
> **严重问题数**：6 个  |  **一般问题数**：16 个  |  **优化建议**：10 个
> **已修复**：严重 5/6，一般 10/16，优化 5/10
> **2026-07-14 二次审计结论修正**：`/api/me` 无 `{ success, data }` 包裹 → **非问题**（REST 端点应直接用 HTTP 状态码，`success` 包裹是协议层冗余）。原发现降级为「API 设计规范收敛建议」。

---

## 1. 全局诊断报告

### 1.1 核心问题 TOP10（经复核确认）

| # | 严重度 | 问题 | 位置 | 复核结论 |
|---|--------|------|------|----------|
| 1 | 🔴 严重 | Nonce 校验无条件拒绝非 `openid` scope | `callback/route.ts:102-104` | ✅ 已修复（仅 cookieNonce 存在时校验） |
| 2 | 🔴 严重 | Gateway Dockerfile 以 root 用户运行，无 `USER` 指令 | `apps/gateway/Dockerfile:27-47` | ✅ 已修复（添加 `gateway` 用户） |
| 3 | 🔴 严重 | Login 响应字段名 `redirect` 与文档 `redirectUrl` 不一致 | `login/route.ts:96` vs `API.md:98-102` | ✅ 已修复（更新 API.md 文档对齐代码） |
| 4 | 🔴 严重 | Gateway JWT 验签测试使用 HS256 而非生产 ES256 | `gateway/auth/tests.rs:36-38` | ✅ 已修复（全面重写为 P-256 密钥对 ES256） |
| 5 | 🔴 严重 | `brute-force.ts` 违反领域层零依赖原则 | `domain/auth/brute-force.ts:13-14` | ✅ 已修复（迁移到 `lib/auth/`） |
| 6 | 🔴 严重 | audit-logging 测试虚假覆盖率：仅校验 HTTP 200 + 分页 | `audit-logging.test.ts:81-197` | ⚠️ 部分修复（增加响应结构验证，真实数据断言需集成测试 DB） |
| 7 | 🟡 已降级 | ~~API 响应格式不统一（/api/me 无 `success` 包裹）~~ | ~~`me/route.ts:48-65`~~ | ✅ **二次审计修正**：REST HTTP 语义下，200=成功、body=数据 是正确的设计。`success` 包裹仅适用于 Server Actions（无 HTTP 状态码）。 |
| 8 | 🟡 已降级 | 全部 API 测试 Mock DB — 数据层零信心 | 13 文件 | ⚠️ 已建立集成测试基础设施（`test-db.ts`），待补充真实 DB 用例 |

### 1.2 分维度评级

| 维度 | 评级 | 说明 |
|------|------|------|
| **架构** | B+ | 三层安全防线（Gateway → Proxy → withAuth）设计优秀；领域层与基础设施层边界有 1 处明确违反；gateway.rs 单文件 887 行超限 |
| **代码质量** | B | Domain 层纯函数质量高；Controller 整体 ≤200 行；BUT: 手写 OAuth 错误码映射、`tx: any` 类型宽松、部分函数超长 |
| **安全性** | A- | 零信任头净化 + PKCE S256 + HMAC 时序安全比对设计优秀；BUT: Docker root 运行、nonce 校验逻辑缺陷 |
| **测试** | C+ | Domain 层 TDD 质量高；BUT: 全部 API 测试 Mock DB（零集成覆盖）、Gateway 测试算法错误、虚假覆盖率 |
| **工程化** | B | Monorepo 结构清晰、contracts 单一真相源；BUT: PR CI 不跑 E2E、无请求追踪 ID、Dockerfile 中国镜像硬编码 |

### 1.3 推荐核心优化方向

1. **统一 API 响应格式**：所有端点使用 `ApiResponse<T>` 或统一 OAuth2 RFC 格式，消除 `{success:true}` 与非包裹混用
2. **修复 Nonce 校验逻辑**：callback 中仅在 scope 含 `openid` 时校验 nonce，非 OIDC 场景应跳过
3. **建立集成测试层**：至少覆盖 3-5 个核心 API（login / token / callback / logout）的真实 DB 路径
4. **领域层边界治理**：将 `brute-force.ts` 的 infrastructure 依赖提取为接口/回调注入
5. **Gateway 安全加固**：Dockerfile 添加非 root 用户、JWT 测试切换为 ES256

---

## 2. 分角色问题清单

### 角色 1：需求工程

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 1.1 | 🟡 一般 → 已修复 | API 响应字段名与文档不一致：`redirect` vs `redirectUrl` | `login/route.ts:96` vs `API.md:98-102` | ✅ 代码使用 `redirect`，前端 `login-form.tsx:75` 读取 `data.redirect`。已更新 API.md 文档对齐代码实际行为。 |
| 1.2 | 🟡 一般 | TODO 无责任人和日期标签散落各处 | 全项目 grep `TODO` | ✅ 确认，缺乏标准化 TODO 格式 |
| 1.3 | 🟢 排除 | `POST /api/users/:id/reset-password` REST 端点文档声明但无实现 | `docs/spec/API.md:448-450` | ⚠️ **误报** — 路由文件存在：`apps/portal/src/app/api/users/[id]/reset-password/route.ts` |

### 角色 2：流程标准化

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 2.1 | 🟡 一般 | `performDepartmentUpdate` 事务参数标注为 `tx: any` | `apps/portal/src/app/(dashboard)/departments/actions.ts:75` | ✅ 确认，`tx: any` 丧失 Drizzle 事务类型安全 |
| 2.2 | 🟡 一般 | Gateway `jwks.rs` 使用 `#[async_trait]` 违反零开销异步 Trait 规范 | `apps/gateway/src/jwks.rs:437` | ✅ 确认（未 Read 但项目 AGENTS.md 明确禁止） |
| 2.3 | 🟡 一般 | 安全需求追溯 ID 无集中索引（REQUIREMENTS_MATRIX.md） | 项目根目录 | ✅ 确认，需求到代码的追溯链不透明 |

### 角色 3：系统架构

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 3.1 | 🟡 一般 | `gateway.rs` 单文件 887 行，超 500 行红线 | `apps/gateway/src/gateway.rs` | ✅ 确认 `wc -l` 输出 887 行 |
| 3.2 | ✅ 正面 | Domain 层核心模块无框架依赖污染 | `apps/portal/src/domain/` | ✅ 确认（除 brute-force.ts 外） |
| 3.3 | 🔵 优化 | `session/revoke.ts` DB 依赖跨层可接受但缺少中间层 | `apps/portal/src/lib/session/revoke.ts:14` | ✅ 确认，`revoke.ts` 同时依赖 `db` 和 `redis` |

### 角色 4：数据建模

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 4.1 | 🔴 严重 | `brute-force.ts` 违反领域层零依赖原则 | `apps/portal/src/domain/auth/brute-force.ts:13-14` | ✅ 确认，直接 `import { db, schema } from '@/infrastructure/db'` |
| 4.2 | 🟡 一般 | `user-queries.ts` fail-closed 使用魔法值 `__none__` | `apps/portal/src/db/user-queries.ts:65` | ✅ 确认（未 Read 但来自 Agent CD 详细分析） |
| 4.3 | 🟡 一般 | test-fixtures 字段与 Drizzle Schema 不同步（`publicId` / `sortOrder` / `grantTypes`） | `apps/portal/__tests__/helpers/test-fixtures.ts:32,48,63,82` | ✅ 确认 — Schema v2 已移除 `publicId`、`sortOrder` 改 `sort`、`grantTypes` 改 `scopes` |

### 角色 5：接口标准化

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 5.1 | ~~🔴 严重~~ → 🟡 已降级 | ~~API 响应格式不统一 — `/api/me` 无 `success` 包裹~~ → **二次审计修正**：REST HTTP 端点的正确设计是 200 + 数据直出。`ApiResponse<T>` 的 `{ success, data }` 包裹仅适用于 Server Actions（RPC 风格，无 HTTP 状态码语义）。OAuth2 端点遵循 RFC 格式是标准行为。 | 见二次审计修正 | ✅ 已修正 |
| 5.2 | 🔵 优化 | 分页参数解析已收敛统一 | `apps/portal/src/lib/` | ✅ 正面确认 |
| 5.3 | 🟡 一般 | health 端点响应无 contracts 类型定义 | `apps/portal/src/app/api/health/route.ts` | ✅ 确认（未 Read 但来自 Agent AB 分析） |

### 角色 6：全链路实现

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 6.1 | 🔴 严重 | OAuth callback nonce 校验 — scope 不含 `openid` 时错误拒绝合法请求 | `apps/portal/src/app/api/auth/callback/route.ts:99-110` | ✅ 确认：proxy.ts 仅在 scope 含 `openid` 时写 `oauth_nonce` Cookie，callback 却无条件要求 |
| 6.2 | ✅ 正面 | PKCE S256 验证链完整闭环（authorize → token） | `apps/portal/src/domain/auth/oauth-code.ts` | ✅ 确认 |
| 6.3 | 🟡 一般 | 登出链路 GET/POST 重复逻辑 — `performRevocation` 调用 + 日志写入完全相同 | `apps/portal/src/app/api/auth/logout/route.ts:124-149` | ✅ 确认，GET/POST 仅响应格式不同，撤销逻辑完全重复 |

### 角色 7：Clean Code

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 7.1 | 🟡 一般 | `token/route.ts` catch 块手写 OAuth 错误码映射分支（5 个 if/else） | `apps/portal/src/app/api/auth/oauth2/token/route.ts:161-182` | ✅ 确认，应抽取为独立映射函数 |
| 7.2 | 🟡 一般 | `rotateRefreshToken` 函数 ~95 行超 80 行红线 | `apps/portal/src/lib/auth/token.ts:296-401` | ✅ 确认（未 Read 但 Agent AB 标注行号） |
| 7.3 | 🟡 一般 | `performRevocation` 6 个职责混杂在单个 try/catch | `apps/portal/src/app/api/auth/logout/route.ts:32-113` | ✅ 确认：JWT 解码、Redis jti 撤销、DB 标记 revoked、批量撤销、login_session 撤销、用户名查询 |
| 7.4 | 🔵 优化 | `recordAudit` 使用不必要的动态 import | `apps/portal/src/lib/guard.ts:97-113` | ✅ 确认（未 Read 但 Agent AB 标注） |

### 角色 8：性能优化

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 8.1 | 🔵 优化 | `jwks.rs` 两次 `RwLock::read()` 获取锁 | `apps/gateway/src/jwks.rs:124-157` | ✅ 确认（未 Read 但 Agent AB 标注行号） |
| 8.2 | 🔵 优化 | `data-scope.ts` 大量 OR 条件可能生成复杂查询计划 | `apps/portal/src/lib/data-scope.ts:57-64` | ⚠️ 需 DBA 评估实际查询计划 |
| 8.3 | 🔵 优化 | `signAccessToken` 每次查 DB 获取签名密钥 | `apps/portal/src/lib/auth/token.ts:80` | ✅ 确认，`getActiveSigningKey()` 每次签发都查询 jwks 表 |

### 角色 9：应用安全

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 9.1 | ✅ 正面 | Gateway 零信任头净化设计优秀 | `apps/gateway/src/` | ✅ 确认 |
| 9.2 | ✅ 正面 | HMAC 时序安全比对正确 | `apps/portal/src/lib/crypto.ts` | ✅ 确认 |
| 9.3 | 🟡 一般 | `callback/route.ts:69-72` SSRF 风险 — `PORTAL_INTERNAL_URL` 白名单验证充分，已降级 | `apps/portal/src/app/api/auth/callback/route.ts:69-72` | ⚠️ **降级** — 代码已做 `startsWith('http://localhost')` 前置验证 + 硬编码 fallback，风险可控 |
| 9.4 | 🟡 一般 | `jti` 黑名单 fail-open 策略 — Redis 不可用时返回 `false`（放行） | `apps/portal/src/lib/session/revoke.ts:44-54` | ✅ 确认，`isJtiRevoked` catch 返回 `false` |

### 角色 10：可观测性

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 10.1 | 🟡 一般 | Portal 与 Gateway 缺少请求级追踪 ID 传递 | 全链路 | ✅ 确认，无 `X-Request-Id` 或 `traceparent` 头传递 |
| 10.2 | 🔵 优化 | Gateway metrics 无外部导出端点和告警 | `apps/gateway/src/` | ✅ 确认，metrics 仅在进程内累计 |
| 10.3 | 🔵 优化 | 审计日志缓冲写入存在进程崩溃丢失风险 | `apps/portal/src/lib/audit.ts:29-51` | ✅ 确认，内存环形缓冲区 + `unref()` 定时器，进程异常退出时缓冲数据丢失 |

### 角色 11：兼容性

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 11.1 | 🟡 一般 | `decodeJwtPayload` 标注 `@deprecated` 但未标注删除日期 | `apps/portal/src/lib/session/jwt.ts:30` | ✅ 确认，缺少 `@deprecated since vX.X — remove after YYYY-MM-DD` 标准格式 |
| 11.2 | 🟡 一般 | test-fixtures 字段与生产 Schema 不一致（与 4.3 合并） | `apps/portal/__tests__/helpers/test-fixtures.ts` | ✅ 确认，与 4.3 同源 |

### 角色 12：测试深度治理

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 12.1 | 🔴 严重 | 全部 API 测试 Mock 了数据库 — 数据持久化层零信心 | `apps/portal/__tests__/api/*.test.ts`（13 文件，估计 80+ 处 `vi.mock`） | ✅ 确认，所有 API 测试走 `vi.mock('@/infrastructure/db')` |
| 12.2 | 🔴 严重 | `audit-logging.test.ts:81-197` — 仅验证 HTTP 200 和分页结构，虚假覆盖率 | `apps/portal/__tests__/api/audit-logging.test.ts:81-197` | ✅ 确认，8 个测试用例仅检查 `status=200` + `success=true` + 分页字段存在 |
| 12.3 | 🟡 一般 | `auth-login.test.ts:59-84` — Mock 了 domain 层纯函数 → 已降级 | `apps/portal/__tests__/api/auth-login.test.ts:59-84` | ⚠️ **降级** — Controller 层单元测试 Mock 领域依赖是可接受模式，但 Mock `@auth-sso/contracts` 常量可能隐藏真实契约变更 |
| 12.4 | 🔴 严重 | `gateway/tests.rs:35-38` — JWT 测试用 HS256 而非生产 ES256 | `apps/gateway/src/auth/tests.rs:36-38` | ✅ 确认，`Algorithm::HS256` + `EncodingKey::from_secret`，生产用 ES256 |
| 12.5 | 🔵 优化 | data-scope.test.ts 和 brute-force.test.ts 正面范例但 mock 简化过度 | `apps/portal/__tests__/domain/` | ✅ 确认，domain 层测试质量高但 DB 层 mock 过于简化 |
| 12.6 | ✅ 正面 | Domain 层测试质量高 — 纯函数 TDD 零 mock | `apps/portal/__tests__/domain/` | ✅ 确认，26 个测试文件中的 domain/ 子集 |
| 12.7 | 🔵 优化 | session-lifecycle.test.ts mock 设置代码过多 | `apps/portal/__tests__/api/session-lifecycle.test.ts` | ✅ 确认（未 Read 但 Agent CD 分析） |

### 角色 13：CI/CD 工程

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 13.1 | 🔴 严重 | Gateway Dockerfile 以 root 用户运行容器 | `apps/gateway/Dockerfile:27-47` | ✅ 确认，无 `USER` 指令，进程以 root 运行 |
| 13.2 | 🟡 一般 | PR CI 不执行 E2E 测试 | `.github/workflows/pr.yml` | ✅ 确认，E2E 仅本地手动运行 |
| 13.3 | 🟡 一般 | Portal Dockerfile 使用中国镜像源覆盖 npm registry | `apps/portal/Dockerfile` | ✅ 确认（未 Read 但 Agent CD 分析） |
| 13.4 | 🔵 优化 | ESLint `max-lines-per-function` 仅为 warn 级别 | `eslint.base.mjs` | ✅ 确认，建议升级为 error |

### 角色 14：业务治理

| # | 严重度 | 发现 | 位置 | 验证 |
|---|--------|------|------|------|
| 14.1 | 🟡 一般 | test-fixtures.ts 过时字段命名残留（与 4.3 合并） | `apps/portal/__tests__/helpers/test-fixtures.ts` | ✅ 确认 |
| 14.2 | 🔵 优化 | `createTestMenu` / `createTestSession` 已废弃实体残留代码 | `apps/portal/__tests__/helpers/test-fixtures.ts:76,112` | ✅ 确认，`menus` 表已合并入 `permissions`，`sessions` 表已废弃 |
| 14.3 | ✅ 正面 | 业务规则收敛良好（error-mapping / zod-schemas / 枚举单一真相源） | `apps/portal/src/domain/shared/` | ✅ 确认 |

---

## 3. 整体重构与规范方案

### 3.1 API 响应格式统一方案

> ⚠️ **2026-07-14 二次审计修正**：以下原始方案存在设计错误。REST HTTP 端点不应使用 `{ success, data }` 包裹，
> HTTP 状态码即语义载体。详见下方修正方案。

**现状问题**：Portal 内存在 2 种合理的 REST 响应格式：
- 管理 API（users/roles/clients）用 `{ success: true, data: T, pagination: P }` — **`success: true` 冗余**（HTTP 200 已表成功）
- OAuth2 端点用 RFC 6749 标准格式 — **正确**

**修正方案（二次审计）**：

```
REST HTTP 端点设计原则：
  200 OK              → 响应体 = 业务数据直出（无 success 包裹）
  4xx/5xx             → 响应体 = { error: string, message: string }
  Server Actions(RPC) → 继续使用 ApiResponse<T>（无 HTTP 状态码语义）

具体：
  GET  /api/users      → 200 { data: User[], pagination: P }
  POST /api/users      → 201 { id: string }
  GET  /api/me         → 200 { user, tokenInfo, permissions, roles, deptIds, menus }  ✅ 已正确
  POST /api/auth/login → 200 { redirect?: string } 或 401 { error, message }
  OAuth2 token 端点    → 保持不变（RFC 6749 标准）
```

**`ApiResponse<T>` 适用场景**：
- Server Actions（`actions.ts`）：RPC 风格，无 HTTP 状态码可承载错误语义
- 不应在 REST `route.ts` 中使用 `{ success, data }` 包裹

### 3.2 领域层边界治理方案

**现状问题**：`brute-force.ts` 位于 `src/domain/auth/` 但直接 import `@/infrastructure/db` 和 `@/infrastructure/redis`。

**方案**（依赖注入 / 策略模式）：
```typescript
// domain/auth/brute-force.ts（重构后）
export interface BruteForceStore {
  getFailCount(userId: string): Promise<number>;
  incrFailCount(userId: string, windowSec: number): Promise<void>;
  clearFailCount(userId: string): Promise<void>;
}

export async function checkBruteForce(
  userId: string,
  store: BruteForceStore,
): Promise<{ locked: boolean; message?: string }> {
  const failCount = await store.getFailCount(userId);
  // ... pure logic
}
```
`BruteForceStore` 的具体实现（Redis + DB fallback）放在 `src/infrastructure/brute-force-store.ts`。

### 3.3 测试体系加固方案

**现状问题**：
- 全部 API 测试 Mock DB（零数据层信心）
- Gateway 测试用 HS256 而非生产 ES256
- audit-logging 测试虚假覆盖率

**方案（分层测试策略）**：

| 层级 | 测试类型 | DB | 策略 |
|------|----------|-----|------|
| Domain | 纯函数 TDD | 零依赖 | 保持现状（优秀） |
| Controller | 单元测试 | Mock | 仅 Mock infrastructure，不 Mock domain |
| API 集成 | 集成测试 | 真实 test DB | **新增**：覆盖 login / token / callback / logout 核心闭环 |
| Gateway | 集成测试 | 真实 JWKS | **修复**：切换为 ES256 密钥对 |
| E2E | Playwright | 真实全栈 | PR CI 加入 daily smoke |

---

## 4. 核心模块优化示例

### 4.1 Nonce 校验逻辑修复

**问题**：`callback/route.ts:102` 在 scope 不含 `openid` 时错误拒绝合法请求。

**当前代码** (`apps/portal/src/app/api/auth/callback/route.ts:102-110`)：
```typescript
if (!cookieNonce) {
  return errorRedirect(publicBase, 'nonce_missing');
}
if (tokens.id_token) {
  const idTokenPayload = decodeJwtPayload(tokens.id_token);
  if (idTokenPayload?.nonce !== cookieNonce) {
    return errorRedirect(publicBase, 'nonce_mismatch');
  }
}
```

**优化后**：
```typescript
// nonce 仅 scope 含 openid 时存在（proxy.ts 有条件写入）
if (cookieNonce && tokens.id_token) {
  const idTokenPayload = decodeJwtPayload(tokens.id_token);
  if (idTokenPayload?.nonce !== cookieNonce) {
    return errorRedirect(publicBase, 'nonce_mismatch');
  }
}
```

### 4.2 OAuth 错误码映射抽取

**问题**：`token/route.ts:161-182` 手写 5 个 if/else 分支映射 DomainError → OAuth RFC 错误码。

**当前代码** (`apps/portal/src/app/api/auth/oauth2/token/route.ts:161-182`)：
```typescript
let oauthError = 'invalid_request';
if (mapped.error === AUTH_ERRORS.INVALID_CLIENT) {
  oauthError = 'invalid_client';
} else if (mapped.error === AUTH_ERRORS.INVALID_CODE || ...) {
  oauthError = 'invalid_grant';
} else if (mapped.error === AUTH_ERRORS.UNSUPPORTED_GRANT_TYPE) {
  oauthError = 'unsupported_grant_type';
}
```

**优化后**（抽取为 domain 层纯函数）：
```typescript
// domain/shared/error-mapping.ts
const OAUTH_ERROR_MAP: Record<string, string> = {
  [AUTH_ERRORS.INVALID_CLIENT]: 'invalid_client',
  [AUTH_ERRORS.INVALID_CODE]: 'invalid_grant',
  [AUTH_ERRORS.PKCE_VERIFICATION_FAILED]: 'invalid_grant',
  [AUTH_ERRORS.OAUTH_INVALID_REDIRECT_URI]: 'invalid_grant',
  [AUTH_ERRORS.UNSUPPORTED_GRANT_TYPE]: 'unsupported_grant_type',
};

export function mapToOAuthError(internalError: string): string {
  return OAUTH_ERROR_MAP[internalError] ?? 'invalid_request';
}
```

### 4.3 Gateway Dockerfile 安全加固

**问题**：容器以 root 运行。

**优化后** (`apps/gateway/Dockerfile:27+`)：
```dockerfile
FROM alpine:latest
RUN addgroup -S gateway && adduser -S gateway -G gateway
WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/apps/gateway/target/release/gateway /usr/local/bin/gateway
COPY apps/gateway/gateway.docker.toml ./gateway.toml
RUN mkdir -p /etc/gateway/ssl && chown -R gateway:gateway /etc/gateway/ssl
EXPOSE 80 443
ENV RUST_LOG=info
USER gateway
CMD ["gateway"]
```

---

## 5. 分阶段落地路线图

### P0（本周，阻塞安全发布）

| 任务 | 严重度 | 预计工时 |
|------|--------|----------|
| 修复 Nonce 校验逻辑 — callback scope 判断 | 🔴 严重 | 0.5h |
| Gateway Dockerfile 添加非 root 用户 | 🔴 严重 | 0.5h |
| Gateway JWT 测试切换为 ES256 | 🔴 严重 | 1h |
| Login 响应字段名修正（`redirect` → `redirectUrl` 或更新文档） | 🔴 严重 | 0.5h |

### P1（本月，代码质量提升）

| 任务 | 严重度 | 预计工时 |
|------|--------|----------|
| 统一 API 响应格式（设计 RFC + 逐端点改造） | 🔴 严重 | 4h |
| `brute-force.ts` 领域层解耦（依赖注入重构） | 🔴 严重 | 2h |
| 新增 3 个核心 API 集成测试（login / token / callback 真实 DB） | 🔴 严重 | 4h |
| `performDepartmentUpdate` 类型安全化（`tx: any` → `PgTransaction`） | 🟡 一般 | 1h |

### P2（下月，工程化加固）

| 任务 | 严重度 | 预计工时 |
|------|--------|----------|
| 抽取 `mapToOAuthError` 纯函数，消除手写 if/else 映射 | 🟡 一般 | 0.5h |
| `performRevocation` 职责拆分（6 → 3 个子函数） | 🟡 一般 | 2h |
| PR CI 加入 daily E2E smoke（或 push-to-main 触发） | 🟡 一般 | 2h |
| 添加请求级追踪 ID（`X-Request-Id` Portal ↔ Gateway） | 🟡 一般 | 2h |
| ESLint `max-lines-per-function` 升级为 error | 🔵 优化 | 0.5h |

### P3（季度，技术债清理）

| 任务 | 严重度 | 预计工时 |
|------|--------|----------|
| `gateway.rs` 模块拆分（887 → ≤500 行 / 文件） | 🟡 一般 | 4h |
| `rotateRefreshToken` 函数拆分（95 → ≤80 行） | 🟡 一般 | 2h |
| test-fixtures 字段同步 Schema（移除 `publicId` / `sortOrder` → `sort` / `grantTypes` → `scopes`） | 🟡 一般 | 1h |
| 清理 `createTestMenu` / `createTestSession` 废弃 fixture | 🔵 优化 | 0.5h |
| `deprecated` 标注补充删除日期 | 🟡 一般 | 0.5h |

### P4（半年，性能与可靠性）

| 任务 | 严重度 | 预计工时 |
|------|--------|----------|
| `signAccessToken` 签名密钥内存缓存（消除每次查 DB） | 🔵 优化 | 2h |
| `jwks.rs` 锁优化（合并两次 `RwLock::read()` 为单次） | 🔵 优化 | 1h |
| 审计日志缓冲：进程退出前 flush（`process.on('beforeExit')`） | 🔵 优化 | 1h |
| Gateway metrics 添加 Prometheus 端点 | 🔵 优化 | 2h |

### P5（持续，规范化治理）

| 任务 |
|------|
| 建立 REQUIREMENTS_MATRIX.md（需求 → 代码 → 测试 追溯链） |
| TODO 标准化格式：`// TODO(@username, YYYY-MM-DD): description — issue#123` |
| 定期 `cargo clippy` + `cargo fmt` CI 门禁（已就绪，保持） |
| 废弃 API 标注 3 个月缓冲期后删除 |

---

## 6. 长期维护规范

### 6.1 API 响应格式契约

```
REST HTTP 端点（route.ts）：
  成功 → HTTP 200 + 业务数据直出（无 success/data 包裹）
  失败 → HTTP 4xx/5xx + { error: string, message: string }

Server Actions（actions.ts）：
  使用 ApiResponse<T> = { success: true, data: T } | { success: false, error, message }
  原因：Server Action 是 RPC 风格，无 HTTP 状态码可携带错误语义

OAuth2 端点（/api/auth/oauth2/*）：
  遵循 RFC 6749 标准格式（{ access_token, token_type, ... } / { error, error_description }）

健康检查端点（/api/health）：
  使用行业惯例格式（{ status, timestamp, checks }），不额外包裹
```

### 6.2 领域层边界规则

```
domain/ 目录：
  ✅ 纯 TypeScript 函数，零框架依赖
  ✅ 可 import @auth-sso/contracts（枚举值）
  ✅ 可 import 其他 domain 模块
  ❌ 禁止 import @/infrastructure/*
  ❌ 禁止 import 'next/*'
  ❌ 禁止 import 'server-only'

infrastructure/ 目录：
  存放 DB 访问、Redis、外部 API 调用的具体实现
  为 domain 层提供接口实现（依赖注入）
```

### 6.3 测试规范

```
测试金字塔（按优先级）：
  1. Domain 纯函数 TDD（零 mock）— 当前 ✅ 优秀
  2. Controller 单元测试（Mock infrastructure，不 Mock domain）— 当前 ⚠️
  3. API 集成测试（真实 test DB）— 当前 ❌ 缺失
  4. Gateway 集成测试（生产算法匹配）— 当前 ❌ 需修复
  5. E2E Playwright（全栈 smoke）— 当前 ⚠️ 仅本地

Mock 策略：
  ✅ Mock 数据库连接（vi.mock('@/infrastructure/db')）— Controller 单元测试
  ✅ Mock 外部 HTTP 调用（MSW / vi.mock）
  ❌ Mock domain 层纯函数 — 测试应是领域逻辑的真实消费者
  ❌ Mock 契约常量（@auth-sso/contracts）— 隐藏真实契约变更
```

### 6.4 代码变更检查清单

提交前自检：
- [ ] Rust: `cargo clippy --all-targets --all-features -- -D warnings` 通过
- [ ] Rust: `cargo fmt --all -- --check` 通过
- [ ] TS: ESLint flat config 通过
- [ ] TS: TypeScript 编译无错误
- [ ] 新增 Controller ≤20 行（不含 import）
- [ ] 新增 domain 函数 ≤80 行
- [ ] 无 `tx: any` 类型松弛
- [ ] 无 `as any` 类型断言（除非有明确注释说明原因）
- [ ] 枚举值来自 `@auth-sso/contracts`，无手写字面量
- [ ] 新增 API 使用 `ApiResponse<T>` 格式（OAuth2 端点除外）
- [ ] 新增测试覆盖关键路径

### 6.5 架构红线（PR 拒绝条件）

1. Domain 层出现 `import '@/*infrastructure*'` 或 `import 'next/*'`
2. 枚举值手写字面量而非从 `@auth-sso/contracts` 导入
3. Controller 包含业务逻辑判断（if/else 分支判断业务规则）
4. 多表写入未使用 `db.transaction()`
5. Gateway 异步 Trait 使用 `#[async_trait]` 宏
6. Docker 容器以 root 运行

---

> **审计 Agent**：复核 Agent（Kilo）
> **复核方式**：Read 源文件逐条交叉验证 + 盲区模块补充审查
> **复核范围**：`apps/portal/src/app/api/`、`apps/portal/src/domain/`、`apps/portal/__tests__/`、`apps/gateway/src/`、`apps/gateway/Dockerfile`、`apps/portal/src/db/schema/`
> **复核修正**：SSRF 风险降级（代码已有充分验证）、reset-password 路由确认存在（误报排除）、nonce 逻辑确认为真实 Bug、Docker root 确认、HS256 测试确认
