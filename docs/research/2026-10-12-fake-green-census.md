# 研究笔记：全仓假绿普查（2026-10-12）

> 研究范围：全仓所有「mock 掉**生产业务模块**（`@/lib/**`、`@/domain/**`、`@/app/**` 的生产代码）且断言落在 mock 行为上」的位置，按三级分类，并回答票据 #29 的四个问题。
> 基线：`main` @ `ad530d6`（工作树干净，与 `origin/main` 同步）。
> 方法：先用 `grep`/`glob` 枚举全部 `vi.mock` 点位（不抽样），再**逐个读取**被 mock 的生产模块源码，核对 mock 的形状是否与真实签名/联合类型一致；最后用**真实执行的变异实验**（M1–M5）验证分类，凡未实测者显式标注为"依据推演，未实跑"。每条结论附 `file:line`。
> 一手来源：仓库源码（含 `AGENTS.md`、`CLAUDE.md`、`docs/adr/ADR-014|016|017|018|019|020`、`docs/solution/2026-10-08-data-scope-fail-open.md`、`docs/archive/solutions/2026-07-09-test-mock-strategy.md`）+ 本机实测（Vitest，Docker Compose 的 `auth-sso-postgres` / `auth-sso-redis` 均 healthy）。

## 判据（本次普查使用的三级定义）

「假绿」= 测试把生产业务模块整体替换成自造实现，且**断言落在 mock 的行为上**，导致"安全网看着在、实际不拦"。按票据 #27 的范围边界，mock 目标是否为生产业务模块决定它能否进入三级：

- **A 确定假绿**：mock 了生产业务模块，且该点位上的断言**只可能由 mock 行为满足**——把对应生产逻辑改坏不会变红。子码：
  - **A1「值即 mock」**：断言的期望值就是 mock 的返回值/参数（含 `mock.calls` 派生值）。
  - **A2「只断言调用」**：该文件对这个 mock 的断言全部是 `toHaveBeenCalled*`。
  - **A3「mock 内手写重实现」**：mock factory 里重新实现了被替换模块的业务逻辑（错误映射 / 纯函数），注释往往还声称"用的是真实实现"。
  - **A4「陈旧 / 幽灵合同」**：mock 声明了生产模块**已不存在或从不曾存在**的导出，或返回已废弃的形状，使真实分支零执行且永不可能失败。
  - **A5「断言的分支在 mock 下不可达」**：mock 的值让被测分支永不执行。
- **B 疑似假绿**：mock 了生产业务模块（机械规则会命中），但该文件的主要断言落在真实 DB / 真实领域代码上，mock 只提供隔离或输入。这一族是"需要理由注解"的候选，而非"断言无效"。
- **C 合法的基础设施或框架 mock**：目标是 `@/infrastructure/**`、`next/*`、`jose`、`ioredis`、`postgres`、`drizzle-orm/*`、`react`、`server-only`、`cmdk`、第三方 UI、跨包 `@auth-sso/*`；`@/lib/env` / `@/lib/logger` 按"配置 / 日志"归入此类（**边界判断，需明示**，见 §6.3）。

> **C 类里没有一个生产业务模块点位**：78 个生产模块 mock 点位全部落在 A 或 B。这不是分类偏好，而是票据 #27 那条机械规则（"扫描模块级 mock，未带理由注解即变红"）在当前仓库的直接后果——理由注解机制尚不存在，因此 **100% 的生产模块 mock 点位在规则落地当天都会变红**；A/B 的区分才是治理的排序依据。

## TL;DR — 最重要的 6 条

1. **确定假绿 42 处 / 疑似假绿 36 处 / 合法 108 处**（三级共 78 个生产模块点位 + 108 个基础设施点位）。确定假绿里最大的一族不是"断言写错"，而是 **11 个测试文件 + 1 个共享 mock 工厂声明了 `@/lib/auth` 已经不存在的导出**（A4，共 12 处声明），其中 `getUserRoleDeptIds` / `canAccessDept` 恰被 `authz-surface.test.ts:28-29` **反向**钉死。
2. **`issueRefreshToken` 的真实实现（含唯一的 DB 写入）可以整段删掉而测试全绿**——实测 M1。票据 #27 的已知事实①得到实测确认。
3. **`logout` 的第 3 层撤销（按 Cookie 撤销当前 RT）可以整段删掉而 `auth-logout.test.ts` 6 例全绿**——实测 M2。根因是 `auth-logout.test.ts:129` 把 `getRefreshTokenFromCookie` 永久 mock 成 `null`。
4. **没有真实 Redis 时，全仓 API 套件是 434 绿 / 3 红**：其中 **2 条"撤销有效"断言天然为真**（`oauth-introspect.test.ts:150`、`oauth-revoke.test.ts:169`），另 3 条"未撤销"断言变成假红——实测 M5。这个"2 真 3 红"的混合信号比"全绿"更危险：容易被读成"撤销逻辑没问题，只是有 3 个奇怪的失败"。
5. **同一变异（删除 `verifyAccessToken` 的 jti 黑名单校验）能被 `oauth-introspect.test.ts:150` 抓住，却抓不住 `oauth-revoke.test.ts`（11 例全绿）与 `token-claims-binding.test.ts`（18 例全绿）**——实测 M4。即：撤销端点至今没有任何断言证明"撤销后的令牌会被拒绝"。
6. **`mock-contract.test.ts` 这个先例守卫保护的是一个没有任何测试使用的 mock 工厂**：`mock-factory.ts` 实测仅被该守卫自身引用（`initHoistedHolders` 0 处调用），因此它宣称防住的漂移（三参 `withPermission`）仍活在 `mock-factory.ts:189`。

---

## 1. 扫描边界（Q1）

### 1.1 全仓测试文件清单（79 个）

| 区域 | 文件数 | 归属 project | 本次扫描 |
|---|---|---|---|
| `apps/portal/__tests__/api/` | 49 | `@auth-sso/portal-api`（`vitest.api.config.ts:21-23`） | ✅ 全量逐个读取 |
| `apps/portal/__tests__/components/` | 6 | `@auth-sso/portal-ui`（`vitest.ui.config.ts:22-28`） | ✅ 全量读取 |
| `apps/portal/__tests__/domain/` | 10 | 同上 | ✅ 全量读取，**0 个 `vi.mock`** |
| `apps/portal/__tests__/helpers/` | 1 | 同上 | ✅ 读取（它测的是 mock 基础设施自身） |
| `apps/portal/__tests__/smoke.test.ts` | 1 | 同上 | ✅ 读取 |
| `apps/portal/src/**/*.test.ts` | 5 | UI project（`vitest.ui.config.ts:27`） | ✅ 全量读取 |
| `packages/contracts/src/**` | 4 | `packages/contracts/vitest.config.ts` | ✅ 全量读取，**0 个 `vi.mock`**（`grep -n "vi.mock\|vi.fn\|mock(" packages/contracts/src` 无命中） |
| `tests/e2e/*.spec.ts` | 3 | Playwright（不在 vitest projects 内，`vitest.config.ts:19-23`） | ✅ 读取，**0 个 mock**（`grep -n "vi.mock\|mock\|stub" tests/e2e/*.spec.ts` 无命中） |

### 1.2 明确**没有**扫到（无测试面，或不在 JS mock 规则射程内）

| 目录 | 状态 | 依据 |
|---|---|---|
| `packages/contracts` | **已扫**（4 文件，0 mock）。票据要求"别只扫 portal"，此处结论为空集 | 同上 |
| `tests/e2e` | **已扫**（3 spec，0 mock）。**但最高价值的那一个默认被跳过**：`playwright.config.ts:9` 的 `testIgnore: process.env.E2E_TARGET === 'docker' ? undefined : '**/docker-release.spec.ts'` 使 Gateway→Portal 登录/登出闭环在默认 `pnpm test:e2e:portal` 下不运行 | `playwright.config.ts:9`；`docs/adr/ADR-017:41`"日志写入会引入……"同族论证 |
| `apps/demo-app` | **零测试文件**（`find apps/demo-app -name '*.test.*' -o -name '*.spec.*'` 为空），且未注册进任何 vitest project（`vitest.config.ts:19-23` 只列 portal-api / portal-ui / contracts） | 同上 |
| `packages/config` | **零测试文件**；其行为实际由 `apps/portal/src/lib/env.test.ts` 与 `apps/portal/src/infrastructure/db/index.test.ts` 覆盖（两者都通过 `@auth-sso/config` 导入被测函数） | `find packages/config -name '*.test.*' -o -name '*.spec.*'` 为空 |
| `apps/gateway`（Rust） | 不在本次 JS mock 普查射程（15 个文件含 `#[test]`/`#[tokio::test]`，走 `cargo test`）。**但守卫规则若只写在 Vitest 层，Rust 侧同类形态不会被覆盖**——跨语言契约锚点见 `gateway-identity-trust.test.ts:11-17` | `grep -rln "#\[test\]\|#\[tokio::test\]" apps/gateway/src` = 15 |
| `tests/traceability/` | 报告生成脚本，非测试 | `package.json` 的 `test:report` |

### 1.3 基线（本机实测，2026-10-12）

- `@auth-sso/portal-api`：**49 文件 / 437 用例全绿**（129.8s）。
- `@auth-sso/portal-ui` + `@auth-sso/contracts`：**27 文件 / 207 用例全绿**。
- 合计 **76 文件 / 644 用例全绿**（另 3 个 Playwright spec 未跑）。
- **`vitest.globalSetup.ts` 只保证 PostgreSQL 存在**（`vitest.globalSetup.ts:63-127` 全程只 `postgres(...)`，无任何 Redis 探测/等待）；Redis 目前"恰好可用"仅因为开发者本机 `docker compose` 起了 `auth-sso-redis`（实测 `docker ps` healthy）。**基线不是被强制的。**

---

## 2. 分级清单

统计口径：以 `vi.mock('<目标>')` 调用点计 1 个**点位**。

| 分类 | 点位数 | 说明 |
|---|---|---|
| **A 确定假绿** | **42** | 断言只可能由 mock 满足 |
| **B 疑似假绿** | **36** | mock 生产模块，但主张断言落真实代码 |
| **C 合法的基础设施 / 框架 mock** | **108** | 不构成假绿；其中 `@/lib/env`(8)+`@/lib/logger`(1) 属边界判断 |
| **合计生产模块点位** | **78** | A+B；C 中无生产模块点位 |

### 2.1 A 确定假绿（42 处）

> 一个 `vi.mock` 点位只列一行，**主码取该点位最严重的缺陷**；同一行可携带次要码（在"承载的断言"里注明）。"唯一能抓住的变异"是 Q4 在点位级上的答案。
> 子码速查：A1 值即 mock / A2 只断言调用 / A3 mock 内手写重实现 / A4 幽灵键或陈旧形状 / A5 分支不可达。

| # | 点位（`vi.mock` 处） | mock 目标 | 主码 | 承载的断言 / 为什么是确定假绿 | 唯一能抓住的变异 |
|---|---|---|---|---|---|
| 1 | `apps/portal/__tests__/api/oauth2-token.test.ts:39-46` | `@/lib/auth/token`（含 `issueRefreshToken`） | A1 | `:168 expect(json.refresh_token).toBe('mock-rt')`；`:277 toHaveBeenCalledWith`；`:292 not.toHaveBeenCalled` | 删掉路由对 mock 的调用（**改坏 `issueRefreshToken` 无效——实测 M1**） |
| 2 | `apps/portal/__tests__/api/oauth2-token.test.ts:48-51` | `@/lib/permissions` | A4 | `:134` 提供旧形状（无 `kind`）⇒ `oauth-grant.ts:162-167` 的 `denied`/`ok` 两分支都不进入，预填充与"用户不可用即拒绝"零执行 | 无 |
| 3 | `apps/portal/__tests__/api/oauth2-token.test.ts:53-57` | `@/lib/audit` | A2 | `:306 expect(mockWriteLoginLog).toHaveBeenCalledWith(objectContaining({eventType}))` | 删掉路由里的 `writeLoginLog` 调用 |
| 4 | `apps/portal/__tests__/api/oauth-grant.test.ts:38-44` | `@/lib/auth/token` | A1 | `:151-153` AT/RT/ID 三值全为 mock 值；`:167/:178 not.toHaveBeenCalled`；`:202 toHaveBeenCalledWith`（家族撤销） | 删掉 `oauth-grant.ts` 里的调用（**实测 M1：12 例全绿**） |
| 5 | `apps/portal/__tests__/api/oauth-grant.test.ts:46-49` | `@/lib/permissions` | A4 | `:27` 提供旧形状（无 `kind`），同 #2 | 无 |
| 6 | `apps/portal/__tests__/api/authorization-code-storage.test.ts:61-68` | `@/lib/auth/token` | A2 | 该文件的 DB 断言真实，但 `issueRefreshToken` 的**签发侧**完全由 mock 承担 | 同 #1（**实测 M1：3 例全绿**） |
| 7 | `apps/portal/__tests__/api/auth-logout.test.ts:66-69` | `@/lib/session/revoke` | A2 | `:159 toHaveBeenCalledWith('jti-1', expect.any(Number))`；`:179`；`:214 not.toHaveBeenCalled` | 删掉 `logout/route.ts:52/:70` 的 `revokeJti` 调用 |
| 8 | `apps/portal/__tests__/api/auth-logout.test.ts:71-73` | `@/lib/auth/token` | A2 | `:158 toHaveBeenCalledWith('valid-jwt', PORTAL_CLIENT_ID, 'at+jwt')` | 删掉 `logout/route.ts:44` 的 `verifyAccessToken` 调用 |
| 9 | `apps/portal/__tests__/api/auth-logout.test.ts:75-77` | `@/lib/session/jwt` | A2 | `:178 toHaveBeenCalledWith('session-jwt')` | 删掉 `logout/route.ts:68` 的 `decodeJwtPayload` 调用 |
| 10 | `apps/portal/__tests__/api/auth-logout.test.ts:79-81` | `@/lib/session/cookies` | A5 | **无断言**——`beforeEach:129` 恒 `mockResolvedValue(null)`，使 `logout/route.ts:78-86`（第 3 层：按 Cookie 撤销 RT）**永不执行** | 无（**实测 M2：删掉整层，6 例全绿**） |
| 11 | `apps/portal/__tests__/api/auth-logout.test.ts:89-91` | `@/domain/shared/error-mapping` | A3 | `:131-135` mock 内**手写重实现**了 `mapDomainError`→500 映射 | 改坏真实 `mapDomainError`（该文件不会红） |
| 12 | `apps/portal/__tests__/api/auth-login.test.ts:35-37` | `@/domain/auth/password` | A2 | `:164`、`:173 expect(mockVerifyPassword).not.toHaveBeenCalled()` —— `verifyPassword` 的真实 bcrypt 实现对**登录端点**零覆盖 | 删掉登录路由对 `verifyPassword` 的调用（`not.toHaveBeenCalled` 反而**更容易**变绿） |
| 13 | `apps/portal/__tests__/api/auth-login.test.ts:39-43` | `@/lib/auth/brute-force` | A2 | `:143`、`:152`、`:164`、`:173` 全部是 mock-call 断言 | 删掉登录路由的 `incrementBruteForce` / `clearBruteForceCounter` 调用 |
| 14 | `apps/portal/__tests__/api/auth-login.test.ts:45-48` | `@/lib/auth/token` | A1 | `:151 expect(res.cookies.get('login_session')?.value).toBe('mock-login-session-jwt')` —— 值即 mock 返回值 | 删掉 Cookie 写入 |
| 15 | `apps/portal/__tests__/api/change-password.test.ts:34-36` | `@/lib/session/revoke` | A2 | `:171 expect(mocks.mockRevoke).toHaveBeenCalledWith(USER_ID)` | 删掉 `change-password.ts:98` 的调用 |
| 16 | `apps/portal/__tests__/api/force-logout-revocation.test.ts:44-50` | `@/lib/session/revoke` | A2 | `:123`、`:142 toHaveBeenCalledWith(user)` | 删掉 `token.ts:400` 的调用 |
| 17 | `apps/portal/__tests__/api/force-logout-route.test.ts:44-50` | `@/lib/session/revoke` | A1 | `:111 expect(body['revokedJtiCount']).toBe(3)`、`:129 toBe(0)` —— 断言的数字**就是 mock 的返回值**，"如实报告实际撤销数"的真实计数链（`revoke.ts:100-128` 的幂等消费）不在断言内；`:121 toHaveBeenCalledTimes(1)`、`:138 not.toHaveBeenCalled` | 改 `token.ts:400` 的返回值传递 |
| 18 | `apps/portal/__tests__/api/force-logout-route.test.ts:52-56` | `@/lib/permissions` | A4 | `:53` 提供旧形状（无 `kind`），同 #2 | 无 |
| 19 | `apps/portal/__tests__/api/force-logout-route.test.ts:59-62` | `@/lib/auth` | A3 | `:60-61` `withPermission: (_opts, handler) => handler(ADMIN_ID)` —— 权限门禁整体旁路，无映射、无鉴权 | 无 |
| 20 | `apps/portal/__tests__/api/force-logout-route.test.ts:64-66` | `@/lib/authz` | A5 | `:65 withScopedWrite: async (_opts, write) => write()` —— 范围快照/守卫 `withScopedWrite` 零执行 | 无 |
| 21 | `apps/portal/__tests__/api/password-reset-session-revocation.test.ts:42-48` | `@/lib/session/revoke` | A2 | `:108 toHaveBeenCalledWith(USER_A)` | 删掉 `reset-password.ts` 的调用 |
| 22 | `apps/portal/__tests__/api/rt-permission-failure.test.ts:32-35` | `@/lib/permissions` | A2 | `:110 toHaveBeenCalledWith(USER_ID, OK_CONTEXT)`；`:84/:130 not.toHaveBeenCalled`（**已知 4 处之三**） | 删/移 `token.ts:365-367` 的预填充调用（**改坏 `cacheUserPermissionContext` 内部——含 Redis setex 与 TTL——无效**） |
| 23 | `apps/portal/__tests__/api/token-claims-binding.test.ts:47-53` | `@/lib/session/revoke`（`:49 isJtiRevoked: vi.fn(async () => false)`） | A1 | 该文件 18 例的"必须被拒"全部在 `isJtiRevoked` 恒 false 下成立（**已知 4 处之四**） | 无（**实测 M4：删掉 `token.ts:167-170` 的黑名单校验，18 例全绿**） |
| 24 | `apps/portal/__tests__/api/token-claims-binding.test.ts:55-58` | `@/lib/permissions` | A4 | `:56` 提供旧形状（无 `kind`），同 #2 | 无 |
| 25 | `apps/portal/__tests__/api/user-actions.test.ts:23-31` | `@/lib/auth` | A4 | `:26-27` 幽灵键 `getUserRoleDeptIds` / `canAccessDept`（生产侧已不存在） | 无 |
| 26 | `apps/portal/__tests__/api/user-actions.test.ts:37` | `@/lib/session/revoke` | A2 | `:233 toHaveBeenCalledWith(userId)` | 删掉 `reset-password` 路由的调用 |
| 27 | `apps/portal/__tests__/api/user-api.test.ts:52-73` | `@/lib/auth` | A4 | `:55-56` 幽灵键；`:157-163` 由 `:159` **硬编码返回 403** 再断言 403（A1）；`:57-71` 手写重实现 `withAuth` 映射、`:34` 仍为**三参** `(opts, resource, handler?)`（A3） | 无 |
| 28 | `apps/portal/__tests__/api/user-role-api.test.ts:30-49` | `@/lib/auth` | A3 | `:33-45` 手写重实现 `withPermission` 的 `DomainError→状态码` 映射：`:181`、`:195 expect(response.status).toBe(403)` 的 403 **由 mock 产生**（`lib/authz/write.ts` 的 `withScopedWrite` 明确抛 `ForbiddenError`，其 JSDoc 写"由调用链上的 `withPermission` / `mapDomainError` 统一映射为 403"）；`:46-47` 另有幽灵键（A4） | 无（同文件 `:184`、`:198` 的 DB 状态断言是真实的） |
| 29 | `apps/portal/__tests__/api/client-api.test.ts:21-27` | `@/lib/auth` | A4 | `:24-25` 幽灵键（**注意 `canAccessDept` / `getUserRoleDeptIds` 正是 `authz-surface.test.ts:28-29` 反向钉死的那两个**） | 无 |
| 30 | `apps/portal/__tests__/api/client-actions.test.ts:22-29` | `@/lib/auth` | A4 | `:25-26` 幽灵键 | 无 |
| 31 | `apps/portal/__tests__/api/department-api.test.ts:48-65` | `@/lib/auth` | A4 | `:53-54` 幽灵键（`mockGetUserRoleDeptIds` 在 `:44` 定义后**从未被重新配置或断言**） | 无 |
| 32 | `apps/portal/__tests__/api/department-actions.test.ts:26-33` | `@/lib/auth` | A4 | `:29-30` 幽灵键 | 无 |
| 33 | `apps/portal/__tests__/api/role-actions.test.ts:23-30` | `@/lib/auth` | A4 | `:26-27` 幽灵键 | 无 |
| 34 | `apps/portal/__tests__/api/role-api.test.ts:36-40` | `@/lib/auth` | A1 | `:152-159` 用 `mockImplementationOnce` **返回一个硬编码 403 `NextResponse`**，随后断言 `status === 403` —— 断言的是 mock 自己的产物 | 无（除"删掉 `withPermission` 调用"） |
| 35 | `apps/portal/__tests__/api/role-api.test.ts:48-51` | `@/lib/audit` | A4 | `logAuditEvent`、`getClientIP` **两个都不存在于 `@/lib/audit`**（真实导出见 `lib/audit.ts:56-243`）；该文件覆盖的 GET 路由实测完全不引用 audit（`grep -n "audit\|Audit" apps/portal/src/app/api/roles/route.ts apps/portal/src/app/api/roles/[id]/route.ts` 无命中）⇒ 这组键是**纯死配置**：不遮蔽任何断言，也永不可能失败 | 无 |
| 36 | `apps/portal/__tests__/api/permission-api.test.ts:30-36` | `@/lib/auth` | A4 | `:33-34` 幽灵键 | 无 |
| 37 | `apps/portal/__tests__/api/permission-api.test.ts:54-57` | `@/lib/audit` | A4 | `:54-57` 幽灵键 `logAuditEvent` / `getClientIP`，同 #35 | 无 |
| 38 | `apps/portal/__tests__/api/permission-actions.test.ts:20-27` | `@/lib/auth` | A4 | `:23-24` 幽灵键 | 无 |
| 39 | `apps/portal/__tests__/api/permission-enforcement.test.ts:90-96` | `@/lib/permissions` | A3 | `:94-95` 内联箭头**重写**了 `toPermissionContextOrNull`，注释却写"用真实实现而非 mock：……mock 掉它等于把待测语义替换成测试自己的假设"——**做的正是它声称拒绝的事** | 无（改坏 `permissions.ts:266-270` 不会红） |
| 40 | `apps/portal/__tests__/api/me-endpoints.test.ts:33-37` | `@/lib/auth` | A4 | `:36` 幽灵键 `getUserRoleDeptIds` | 无 |
| 41 | `apps/portal/__tests__/api/me-endpoints.test.ts:39-41` | `@/lib/menu-tree` | A1 | `:129 expect(body.menus).toBeDefined()` —— mock 恒返回 `[]`，断言恒真；菜单树内容零断言 | 让 `getDynamicMenuTree` 抛错（`menus` 变 undefined） |
| 42 | `apps/portal/__tests__/components/audit-logs.test.tsx:25-29` | `@/lib/auth/verify-jwt` | A4 | `resolveIdentity` 返回 `{claims:{...}}` —— **既用 ADR-016 已删除的形状，又缺 `userId`**；`me-endpoints.test.ts:80-81` 的注释已自陈"`ResolvedIdentity` 已不再携带 claims" | 无 |

**A 类小计：42 处。**

主码分布：**A1 = 7**（#1,4,14,17,23,34,41）、**A2 = 12**（#3,6,7,8,9,12,13,15,16,21,22,26）、**A3 = 4**（#11,19,28,39）、**A4 = 17**（#2,5,18,24,25,27,29,30,31,32,33,35,36,37,38,40,42）、**A5 = 2**（#10,20）。
A4 内部：**幽灵键 14 处**（`@/lib/auth` 的 `getUserRoleDeptIds`/`canAccessDept` 共 **11 行**：#25,27,28,29,30,31,32,33,36,38,40；`@/lib/audit` 的 `logAuditEvent`/`getClientIP` **2 行**：#35,37；`ResolvedIdentity.claims` **1 行**：#42。**另在 `helpers/mock-factory.ts:64-65,127-128,196-198` 重复声明，但该文件不是测试文件，不计入 78 点位**）+ **陈旧返回形状 4 处**（#2,5,18,24；其中 #28 的次要码亦为 A4）。

### 2.2 B 疑似假绿（36 处）

形态：mock 了生产业务模块（机械规则会命中），但该文件的主要断言落在**真实 PostgreSQL / 真实领域函数**上，mock 只提供隔离或输入。它们**不需要被"换成真实实现"**，需要的是**理由注解**。一行为一个点位。

| # | 点位（`vi.mock` 处） | mock 目标 | 为什么是 B（而非 A） |
|---|---|---|---|
| 1 | `apps/portal/__tests__/api/auth-login.test.ts:50-54` | `@/lib/audit` | 无断言；登录端点在该文件不写审计 |
| 2 | `apps/portal/__tests__/api/auth-logout.test.ts:83-87` | `@/lib/audit` | 无断言 |
| 3 | `apps/portal/__tests__/api/authorization-code-storage.test.ts:37-43` | `@/app/(dashboard)/clients/data` | mock 内部**透传到真实 DB**（`:38-42`），断言是真实写入形态 |
| 4 | `apps/portal/__tests__/api/authorization-code-storage.test.ts:45-53` | `@/app/api/auth/oauth2/authorize/data` | 固定夹具提供用户/角色输入，断言落在真实写入 |
| 5 | `apps/portal/__tests__/api/authorization-code-storage.test.ts:55-59` | `@/lib/session/auth-request-store` | 无断言 |
| 6 | `apps/portal/__tests__/api/authorization-code-storage.test.ts:70-73` | `@/lib/permissions` | 形状**正确**（`:71` 含 `kind: 'ok'`）；无断言 |
| 7 | `apps/portal/__tests__/api/auth-refresh.test.ts:69-72` | `@/lib/audit` | 用 `importOriginal` 保留真实实现、只覆盖 `writeLoginLog`；核心（HMAC 信任边界、RT 轮换、sender 绑定）全部真实 |
| 8 | `apps/portal/__tests__/api/client-actions.test.ts:30-35` | `@/lib/crypto` | 断言落在真实 DB 的 client 行上（secret 哈希语义由假实现决定） |
| 9 | `apps/portal/__tests__/api/department-actions.test.ts:34-37` | `@/lib/crypto` | `generateUUID` 固定值；无断言 |
| 10 | `apps/portal/__tests__/api/department-api.test.ts:67-71` | `@/lib/crypto` | `hashToken` 恒等；无断言 |
| 11 | `apps/portal/__tests__/api/force-logout-route.test.ts:68` | `@/lib/cache-invalidation` | 无断言 |
| 12 | `apps/portal/__tests__/api/gateway-identity-trust.test.ts:54-56` | `@/lib/auth/token` | 核心是真实 HMAC（独立 `node:crypto` 计算 + `:108` 与 Rust 侧同向量），仅 `:235-247` 的回退分支由 mock 驱动 |
| 13 | `apps/portal/__tests__/api/gateway-identity-trust.test.ts:58-60` | `@/lib/session` | `getJwtFromCookie` 由测试头驱动 |
| 14 | `apps/portal/__tests__/api/oauth2-authorize.test.ts:24-26` | `@/app/(dashboard)/clients/data` | 断言落在路由分支逻辑（`error`/`state`/`iss`、redirect_uri 精确匹配），输入为 mock client |
| 15 | `apps/portal/__tests__/api/oauth2-authorize.test.ts:28-30` | `@/app/api/auth/oauth2/authorize/data` | 同上 |
| 16 | `apps/portal/__tests__/api/oauth2-authorize.test.ts:32-36` | `@/lib/session/auth-request-store` | 无断言；"授权请求暂存"在该文件零覆盖（`authorization-code-storage.test.ts:1-19` 自陈同族缺口） |
| 17 | `apps/portal/__tests__/api/oauth2-authorize.test.ts:38-40` | `@/lib/auth/token` | `verifyAccessToken` 提供 SSO 免登分支的输入 |
| 18 | `apps/portal/__tests__/api/permission-actions.test.ts:28-30` | `@/lib/crypto` | `generateUUID` 固定值；无断言 |
| 19 | `apps/portal/__tests__/api/permission-actions.test.ts:31` | `@/lib/permissions` | 无断言 |
| 20 | `apps/portal/__tests__/api/permission-actions.test.ts:32` | `@/lib/session/revoke` | 无断言 |
| 21 | `apps/portal/__tests__/api/permission-api.test.ts:49-52` | `@/lib/crypto` | `generateUUID` 计数器 + `generateId` 固定；无断言 |
| 22 | `apps/portal/__tests__/api/permission-enforcement.test.ts:115-117` | `@/lib/session` | `getJwtFromCookie` 提供身份输入；授权判定由真实 `checkPermission` 逻辑驱动 |
| 23 | `apps/portal/__tests__/api/permission-enforcement.test.ts:119-121` | `@/lib/auth/token` | 同上；`:457-467`"无效 JWT → 401"由 mock 返回值驱动 |
| 24 | `apps/portal/__tests__/api/role-actions.test.ts:31-34` | `@/lib/crypto` | 无断言 |
| 25 | `apps/portal/__tests__/api/role-actions.test.ts:35` | `@/lib/permissions` | 无断言 |
| 26 | `apps/portal/__tests__/api/role-actions.test.ts:36` | `@/lib/session/revoke` | 无断言 |
| 27 | `apps/portal/__tests__/api/role-api.test.ts:42-46` | `@/lib/crypto` | `hashToken: (t) => t` 恒等；无断言（但恒等哈希使"令牌以哈希存储"在该文件不可断言） |
| 28 | `apps/portal/__tests__/api/rt-reuse-detection.test.ts:43-46` | `@/lib/permissions` | 无断言；核心是真实 DB 的家族级联/隔离（**实测 M3：删掉 `token.ts:315-320`，该文件 2 例变红**） |
| 29 | `apps/portal/__tests__/api/user-actions.test.ts:32-36` | `@/lib/crypto` | `hashToken` 恒等；无断言 |
| 30 | `apps/portal/__tests__/api/user-api.test.ts:75-79` | `@/lib/crypto` | 同 #29 |
| 31 | `apps/portal/__tests__/api/user-api.test.ts:81` | `@/lib/session/revoke` | 无断言 |
| 32 | `apps/portal/__tests__/api/user-api.test.ts:83-87` | `@/domain/auth/password` | 该文件不断言密码语义（由 `user-actions.test.ts` / `change-password.test.ts` 用真实实现覆盖） |
| 33 | `apps/portal/__tests__/api/user-role-api.test.ts:51` | `@/lib/permissions` | 无断言 |
| 34 | `apps/portal/__tests__/api/user-role-api.test.ts:52` | `@/lib/session/revoke` | 无断言 |
| 35 | `apps/portal/__tests__/api/user-role-api.test.ts:53-57` | `@/lib/audit` | `:157` 用 `mockRejectedValueOnce` **制造**审计失败输入，`:155-162` 断言真实事务回滚 ⇒ 该断言**可被变异验证**（改坏回滚会红），mock 只供输入 |
| 36 | `apps/portal/__tests__/components/audit-logs.test.tsx:14-17` | `@/app/audit/data` | mock 恒返回空集 ⇒ **只覆盖空状态渲染**；`:34-45` 的断言本身诚实，但"有数据时的渲染"零覆盖 |

### 2.3 对账：78 个生产模块点位的 A/B 归属

| 文件 | 生产模块点位 | A | B |
|---|---|---|---|
| `auth-login.test.ts` | 4 | 3 | 1 |
| `auth-logout.test.ts` | 6 | 5 | 1 |
| `authorization-code-storage.test.ts` | 5 | 1 | 4 |
| `auth-refresh.test.ts` | 1 | 0 | 1 |
| `change-password.test.ts` | 1 | 1 | 0 |
| `client-actions.test.ts` | 2 | 1 | 1 |
| `client-api.test.ts` | 1 | 1 | 0 |
| `department-actions.test.ts` | 2 | 1 | 1 |
| `department-api.test.ts` | 2 | 1 | 1 |
| `force-logout-revocation.test.ts` | 1 | 1 | 0 |
| `force-logout-route.test.ts` | 5 | 4 | 1 |
| `gateway-identity-trust.test.ts` | 2 | 0 | 2 |
| `me-endpoints.test.ts` | 2 | 2 | 0 |
| `oauth2-authorize.test.ts` | 4 | 0 | 4 |
| `oauth2-token.test.ts` | 3 | 3 | 0 |
| `oauth-grant.test.ts` | 2 | 2 | 0 |
| `password-reset-session-revocation.test.ts` | 1 | 1 | 0 |
| `permission-actions.test.ts` | 4 | 1 | 3 |
| `permission-api.test.ts` | 3 | 2 | 1 |
| `permission-enforcement.test.ts` | 3 | 1 | 2 |
| `role-actions.test.ts` | 4 | 1 | 3 |
| `role-api.test.ts` | 3 | 2 | 1 |
| `rt-permission-failure.test.ts` | 1 | 1 | 0 |
| `rt-reuse-detection.test.ts` | 1 | 0 | 1 |
| `token-claims-binding.test.ts` | 2 | 2 | 0 |
| `user-actions.test.ts` | 3 | 2 | 1 |
| `user-api.test.ts` | 4 | 1 | 3 |
| `user-role-api.test.ts` | 4 | 1 | 3 |
| `components/audit-logs.test.tsx` | 2 | 1 | 1 |
| **合计** | **78** | **42** | **36** |

### 2.4 C 合法的基础设施 / 框架 mock（108 处，汇总）

| 目标 | 点位数 | 备注 |
|---|---|---|
| `@/infrastructure/db` | 44 | `vi.mock` 后以 getter 透传到真实 PostgreSQL（`helpers/test-db.ts:41-45`），是**真实 DB 基线**的载体 |
| `@/infrastructure/redis` | 15 | 形态差异很大，见 §3.3；`helpers/mock-factory.ts` 的 `MockRedisStore`（238 行）实测只有它自己的测试在用 |
| `next/headers` · `next/cache` · `next/navigation` · `next/server` · `next/link` | 9 · 9 · 4 · 3 · 1 | 框架；`vitest.setup.ts:28-31` 的全局 `next/headers` mock 返回空 Headers/空 cookies，使认证走兜底逻辑 |
| `jose` | 2 | 三方密码学库；**但断言落在 mock 上，见 §4 N10** |
| `ioredis` · `postgres` · `drizzle-orm/postgres-js` | 1 · 1 · 1 | 驱动 |
| `react` · `server-only` · `cmdk` | 1 · 1 · 1 | 框架/UI |
| `@auth-sso/contracts` · `@auth-sso/config` | 1 · 1 | 跨包（前者用 `importOriginal` 透传） |
| `@/lib/env` · `@/lib/logger` | 8 · 1 | **边界判断**：配置/日志属基础设施；其中 6 处用 `importOriginal` 只覆盖单个 getter（`auth-refresh:64`、`gateway-identity-trust:49`、`oauth2-authorize:49`、`oidc-discovery:30`、`token-claims-binding:42`、`authorization-code-storage:75`），2 处为整体替换（`mock-contract:26`、`redis/index.test.ts:30`） |
| `@/components/ui/sidebar` · `dropdown-menu` · `command` | 3 | 自家 UI 原子 |
| `@/hooks/use-permissions` | 1 | **边界外**：`@/hooks/**` 不在票面 glob 内，但它是生产代码（`permission-guard.test.tsx:20-22`），`hasPermission` 由 `vi.fn(() => true)` 驱动 |

**样板（C 类里做得对、可直接当先例引用的文件）**：`audit-retry.test.ts:22-25` + `audit-durability.test.ts:26-29`（真实 `@/lib/audit` + mock 驱动，重试次数/退避/两档相反语义全部由真实实现驱动）、`rt-revocation.test.ts`（真实撤销原语矩阵，含事务回滚原子性）、`authz-write.test.ts:1-14`（真实 PostgreSQL 可见性时序）、`signing-key-cache.test.ts:48-53`（模块级缓存的显式重置出口）、`fixture-keypair.test.ts`（夹具自检，专治"夹具失效与 mock 互相掩盖"）、`deployment-wiring.test.ts`（读真实部署文件）、`client-credentials.test.ts`（纯函数）、`authz-surface.test.ts`（静态公开面契约 + 变异验证，ADR-014 步骤 5）。

---

## 3. 真实 Redis 基线缺失的影响（Q2）

### 3.1 机制（源码事实）

`apps/portal/src/lib/session/revoke.ts:42-53`：

```ts
export async function isJtiRevoked(jti: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) return true; // fail-close：Redis 不可用时假定已撤销
    await redis.connect?.();
    const result = await redis.exists(`${JTI_BLOCKLIST_PREFIX}${jti}`);
    return result === 1;
  } catch (error) {
    log.error('查询 jti 黑名单失败，降级返回 true（fail-close）', ...);
    return true;
  }
}
```

两层后果：
1. **Redis 不可达 ⇒ `isJtiRevoked` 对任意 jti 恒返回 `true`**（`:49-52` 的 catch），于是"已撤销的令牌被拒"这类断言**天然为真**；同时"未撤销的令牌可用"这类断言**变成假红**。
2. **`if (!redis) return true`（`:45`）在生产不可达**：`apps/portal/src/infrastructure/redis/index.ts:143-148` 的签名是 `getRedis(): RedisClient`（非空），所以该分支只在测试把 `getRedis` mock 成假值时被激活。

### 3.2 实测（M5）：把 `REDIS_URL` 指向死端口后的全量结果

命令：`REDIS_URL=redis://127.0.0.1:6399 npx vitest run --project @auth-sso/portal-api`
结果：**47 文件绿 / 2 文件红；434 用例绿 / 3 用例红**（对照基线 437 全绿）。

| 断言 | 无真实 Redis 时 | 分类 |
|---|---|---|
| `oauth-introspect.test.ts:150` `expect(body.active).toBe(false)`（"**已被撤销（jti 进黑名单）的 AT → active:false**"） | **通过（天然为真）** | **无真实 Redis 时天然为真** |
| `oauth-revoke.test.ts:169` `expect(await isJtiRevoked(jti)).toBe(true)`（"本 client 的 AT → jti 进入黑名单"） | **通过（天然为真）** | **无真实 Redis 时天然为真** |
| `oauth-introspect.test.ts:134` `expect(body.active).toBe(true)`（"有效 AT → active:true"） | **失败** | 依赖真实 Redis 的"未撤销"侧 |
| `oauth-revoke.test.ts:182` `expect(await isJtiRevoked(jti)).toBe(false)`（"他人 client 的 AT → 静默忽略，不得撤销"） | **失败** | 同上 |
| `oauth-revoke.test.ts:193` `expect(await isJtiRevoked(jti)).toBe(false)`（"token_type_hint=refresh_token 时跳过 AT 分支"） | **失败** | 同上 |

其余 46 个文件（含 `session-lifecycle.test.ts` 13 例全绿——它 mock 了 `@/infrastructure/redis`，用内存 Map，因此**对真实 Redis 的有无免疫**）不受影响。

> **关键结论**：缺失真实 Redis 基线**不是**"全绿"，而是 **"2 条天然为真 + 3 条假红"的混合信号**。后者更危险：3 条假红出现在"不得撤销"的负例上，容易被误诊为"撤销逻辑允许越权"，而真正的空洞（2 条 tautology）被这 3 条噪声掩盖。**因此"要求真实 Redis"不能只写成语义目标，必须写成 globalSetup 的硬断言**（对照 `vitest.globalSetup.ts:86-91` 对 PostgreSQL 的做法）。

### 3.3 15 个 Redis mock 的形态分档（决定了各自"无真实 Redis"时的行为）

| 形态 | 点位 | 无真实 Redis 时的实际行为 |
|---|---|---|
| **内存 fake**（可注入错误） | `brute-force.test.ts:32-39`（`redisState.redisError` 可抛）、`session-lifecycle.test.ts:57-59`、`jwks-rotation.test.ts:41-43`、`health.test.ts:26-28`、`mock-factory.ts:26`（`MockRedisStore`） | 与真实 Redis 无关；`brute-force.test.ts` 是**全仓唯一真正模拟了"Redis 抛错"**的文件（`:12-13`、`:32-38`） |
| **内存 fake（不可注入错误）** | `permission-enforcement.test.ts:40-59`（`get` 恒 `null`、**永不抛**）、`revoke-batch-result.test.ts:40-55`（`hgetall` 可 reject ⇒ 可注入）、`permission-cache-refresh-result.test.ts:39-45`（`del` 可 reject ⇒ 可注入） | 见 §4 N3：`permission-enforcement` 的"Redis 故障"用例是假绿 |
| **空模块 `{}`** | `user-actions.test.ts:38`、`role-actions.test.ts:37`、`permission-api.test.ts:59`、`role-api.test.ts:53` | `getRedis` 为 `undefined` ⇒ 任何调用抛 TypeError ⇒ 对 `revoke.ts` / `permissions.ts` 等价于"**Redis 永久宕机**"：`revokeJti` 静默 no-op（`:34-36` catch）、`isJtiRevoked` 恒 `true`、`trackUserJti` 静默 no-op、`getUserPermissionContext` 落 DB。这 4 个文件当前不涉及 jti 断言，故为**潜伏**形态 |
| **`getRedis` 返回假值** | `user-api.test.ts:82`（`vi.fn(() => null)`）、`me-endpoints.test.ts:44`（`() => null`）、`authz-surface.test.ts:21`（`vi.fn()` ⇒ `undefined`） | **激活生产不可达的 `if (!redis)` 分支**：`revoke.ts:31`/`:68` 变成"永远跳过写入"，`revoke.ts:45` 变成"永远判已撤销"。这是全仓唯一让该分支可被执行的形态 |

---

## 4. 已知 4 处之外的**新增**假绿点位（Q3）

> 已知 4 处（票据 #27）= ① `issueRefreshToken` 真实实现零覆盖；② jti 黑名单无法区分真撤销与 fail-close；③ 权限缓存预填充只断言 mock 被调用（`rt-permission-failure:110`）；④ `token-claims-binding:49` 直接 mock `isJtiRevoked`。**以下均为新增**。

### N1 `apps/portal/__tests__/api/auth-logout.test.ts:129` —— logout 第 3 层撤销零覆盖（A5，**实测 M2**）

```ts
mockGetRefreshTokenFromCookie.mockResolvedValue(null);   // auth-logout.test.ts:129
```
`beforeEach` 把 `getRefreshTokenFromCookie` 永久设为 `null`，于是 `apps/portal/src/app/api/auth/logout/route.ts:78-86`（"3. DB: 标记当前 Refresh Token revoked"）**在 6 个用例中一次都没执行**。而该文件的文档头（`:4-8`）自称覆盖"四层撤销闭环"、`route.ts:4-8` 也把第 3 层列为承诺。
**为什么是假绿**：把 `route.ts:78-86` 整段删除，6 例全绿（实测 M2）。该文件对 RT 的断言为零——`revokeUserRefreshTokens`（第 4 层）虽未 mock、但没有任何用例种过 RT 行，故其效果也不可观测。
**变异可行性**：无（唯一变异是删分支，而删分支不会红）。

### N2 `apps/portal/__tests__/api/permission-cache-refresh-result.test.ts:47-50` + `:63-68` —— "全部成功"在 DB 完全不可用时同样成立（A1，**实测日志证据**）

```ts
vi.mock('@/infrastructure/db', () => ({ db: {}, schema: {} }));          // :47-50
it('全部成功 → succeeded 等于用户数，failed 为 0', async () => { ... });   // :63-68
```
`db` 是空对象 ⇒ `getUserPermissionContext`（`permissions.ts:151` 的 `db.query.users.findFirst`）抛 `TypeError`，被 `:245-253` 吞掉后返回 `{kind:'unavailable'}`，而 `refreshUserPermissionCache`（`:279-295`）对 `unavailable` 仍 `return { ok: true }`。
**实测证据**（基线跑批日志，逐字）：
```
{"level":50,...,"name":"PermissionContext","error":"Cannot read properties of undefined (reading 'users')","msg":"Database query error"}
{"level":30,...,"name":"PermissionContext","userId":"...101","msg":"Refreshed cache for user"}
{"level":30,...,"name":"PermissionContext","userId":"...201","msg":"Refreshed cache for user"}
{"level":30,...,"name":"PermissionContext","msg":"Refreshed cache for 2 users"}
```
即"全部成功"用例断言 `succeeded=2` 的同时，真实 DB 读取**抛了错**、代码仍打印"Refreshed cache for 2 users"。
**附带发现（生产缺陷，超出本票但同族）**：`refreshUserPermissionCache` 无法区分 `unavailable`/`denied` 与成功——`failed` 只统计 `redis.del` 抛错。这是"把永不失败的调用当失败信号"的**第 4 次出现**（前三次见 HEAD `ad530d6`、`d685c46`、`a7fa3cb` 三个 commit 的 message）。
**变异可行性**：失败方向（`:70-79`）**可以**变异验证（把 `return {ok:false}` 改成 `{ok:true}` 会红）；成功方向**不可以**（`db: {}` 使成功路径不存在）。

### N3 `apps/portal/__tests__/api/permission-enforcement.test.ts:40-59` + `:486-506` —— "Redis 故障"用例测的是"缓存未命中"（A1）

`:40-59` 的 Redis fake 里 `get: async () => null` 是**常量**，**没有任何抛错能力**；`:489` 的注释也承认"当前 mock Redis.get 返回 null，模拟无缓存命中"。于是：
- `:486` "Redis 不可用时降级 DB，授权决策不受影响"
- `:497` "连续 Redis 故障不应抛出未捕获异常"

两例实际断言的是"缓存未命中时授权仍正确"。**删掉 `permissions.ts:143-146` 的 Redis 降级 catch、甚至把 `getRedis()` 整体改成抛错**，这两例都不会变红（因为 `getUserPermissionContext` 本身在该文件被 `:90-96` 整体 mock，Redis 根本不参与）。
另注：`:457` 的用例名是"权限上下文为 null 时返回 500"，断言却是 `statusCode === 401`（`:466`）——命名与断言相反。
**变异可行性**：不可（除非先改 mock 使其可抛；那已不是对生产代码的验证）。**对照样板**：`brute-force.test.ts:12-13,32-38` 证明本仓库完全有能力构造可抛错的 Redis fake。

### N4 `apps/portal/__tests__/api/permission-enforcement.test.ts:94-95` —— 注释声称"真实实现"，实为内联重写（A3）

```ts
vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mockGetUserPermissionContext,
  // 用真实实现而非 mock：它是纯收窄函数（result → context | null），
  // mock 掉它等于把待测语义替换成测试自己的假设。
  toPermissionContextOrNull: (r: { kind: string; context?: unknown }) =>
    r.kind === 'ok' ? r.context : null,
}));
```
第二行注释是**错的**：它是一个新的箭头函数，不是 `permissions.ts:266-270` 的真实实现（`importOriginal` 才是）。改坏真实 `toPermissionContextOrNull`（如改成恒 `null`）不会让该文件变红。
**变异可行性**：不可。

### N5 `apps/portal/__tests__/api/user-role-api.test.ts:33-45`（+ `user-api.test.ts:57-71`、`force-logout-route.test.ts:60-61`）—— mock 内手写重实现 `withPermission` 的错误映射，403 由 mock 产生（A3）

`user-role-api.test.ts:181`、`:195` 断言 `status === 403`，但 `403` 是 `:38`（mock 内的 `err.code === COMMON_ERRORS.FORBIDDEN ? 403`）算出来的。生产侧的权威在哪里？`apps/portal/src/lib/authz/write.ts` 的 `withScopedWrite` **抛** `ForbiddenError`，其 JSDoc 明确写"越界时抛出 `ForbiddenError`，由调用链上的 `withPermission` / `mapDomainError` 统一映射为 403"。**因此把真实 `guard.ts` 的映射改坏，这些 403 断言不会变红。**
同文件 `:184`、`:198` 的"绑定未改变"是真实 DB 断言（**可**变异验证），两者必须分开看。
`user-api.test.ts:157-163` 更极端：403 由 `:159` 的 `mockImplementationOnce` **硬编码返回**。
**变异可行性**：不可（映射住在 mock 里）。

### N6 幽灵 mock 键 —— 12 处声明 + 4 处陈旧返回形状（A4，见 §2.1 主码为 A4 的 17 行）

三类，全部**不可能被任何生产变异击中**：
1. `getUserRoleDeptIds` / `canAccessDept`（`@/lib/auth` 自 ADR-014 起不再导出，`lib/auth/index.ts:16-21`；被 `authz-surface.test.ts:28-29` 反向钉住）：**11 个测试文件 + `helpers/mock-factory.ts:64-65,127-128`**。
2. `logAuditEvent` / `getClientIP`（`@/lib/audit` 无此导出）：`role-api.test.ts:48-51`、`permission-api.test.ts:54-57`。
3. `ResolvedIdentity.claims`（ADR-016 已删）：`helpers/mock-factory.ts:196-198`、`audit-logs.test.tsx:25-29`（且缺 `userId`）；`getUserPermissionContext` 的旧形状（无 `kind`）：`oauth-grant.test.ts:27`、`oauth2-token.test.ts:134`、`force-logout-route.test.ts:53`、`token-claims-binding.test.ts:56`。
**为什么是假绿**：mock 是模块的**超集**，多余的键永不报错；它让读者以为某能力已被隔离，同时让"mock 与真身契约漂移"这件事**在测试里完全不可见**——这正是 `mock-contract.test.ts` 存在的理由，但它只比对 `Function.length`，看不到键集。
**变异可行性**：不可（没有对应生产代码可改坏）。只能靠**静态键集/形状比对守卫**。

### N7 `apps/portal/__tests__/api/mock-contract.test.ts` 的守卫盲区 —— 它守护的 mock 工厂实测 0 个真实采用者（A4）

`mock-contract.test.ts:32,46` 只检查 `createHoistedHolders().mockAuth`。实测：
- `createHoistedHolders` / `initHoistedHolders` 的全仓引用只有 `helpers/index.ts:7-8`（re-export）、`mock-factory.ts` 自身、以及 `mock-contract.test.ts:32,46`。**没有任何 API 测试使用该工厂**。
- `mock-redis.ts`（238 行）只被 `helpers.test.ts`（其自身测试）与 `mock-factory.ts` 引用；`mock-auth.ts`、`test-fixtures.ts` 同理。
- 与此同时，`docs/archive/solutions/2026-07-09-test-mock-strategy.md:60-64` 的"统一 Mock 工厂"目标（17/17）实测停在 **0/17**（`mock-contract.test.ts` 自陈旧缺陷在 `mock-factory.ts` 与 `user-actions.test.ts`，两者现在都是内联 mock）。
- 更直接：该守卫宣称修掉的**三参 `withPermission` 漂移仍然活着**——`mock-factory.ts:189-193` 的 `initHoistedHolders` 重新安装 `(_opts, _req, handler)` 三参形状。守卫只读 `createHoistedHolders()` 返回的**初值**（`:119-122` 两参，`Function.length === 2`），因此**永远扫不到 `:189`**。
- 结论：`mock-contract.test.ts` 目前是**假安全感**——它保护一个无消费者的工厂，而 11 处真实内联 mock 的漂移在它的扫描范围之外。
**变异可行性**：不可（`initHoistedHolders` 0 处调用，是死代码路径）。

### N8 `role-api.test.ts:152-159` / `user-api.test.ts:157-163` —— 403 用例把断言建立在"mock 返回一个 403"上（A1）

```ts
// role-api.test.ts:152-159
vi.mocked(mockWithPermission).mockImplementationOnce(
  async () => NextResponse.json({ error: 'forbidden', ... }, { status: 403 }),   // :155
);
const response = await ListRoles(createTestRequest('/api/roles'));
expect(response.status).toBe(403);                                              // :159
```
整个授权拒绝路径（`checkPermission` 的判定 + `withPermission` 的映射）都由 mock 顶替；`role-api.test.ts:6` 的文件头仍声称覆盖"权限检查（403）"。
**变异可行性**：不可。

### N9 `apps/portal/__tests__/api/me-endpoints.test.ts:39-41` + `:129` —— 菜单树断言恒真（A1）

`getDynamicMenuTree` 被 mock 为恒返回 `[]`，而唯一相关断言是 `expect(body.menus).toBeDefined()`。菜单构建逻辑（`@/lib/menu-tree`）在该文件零覆盖。
**变异可行性**：仅"让 mock 抛错"能让它红——不是对生产代码的变异。

### N10 `apps/portal/__tests__/api/token-claims-binding.test.ts:12` 的自陈与 `apps/portal/__tests__/api/session-lifecycle.test.ts:70-98` 的 `jose` mock —— "验签"由查表冒充（A1/C 跨界）

`session-lifecycle.test.ts:70-98` 把整个 `jose` 换成"按 token 字符串查表"的 `jwtVerify`/`decodeProtectedHeader`，因此 `:161-165`"对有效 JWT 成功验签并返回载荷"**没有发生任何密码学验证**。`token-claims-binding.test.ts:11-13` 的表格自陈此事（"`aud` 必须等于预期 client …… **仅 mock 冒充**（session-lifecycle 的 jose mock）"）。
**代价的实证（M4）**：`session-lifecycle.test.ts:170`"如果 jti 在黑名单中则返回 null"**确实**在 M4 下变红——说明该文件的**黑名单**断言有效（经内存 fake），失效的只是**验签**那一半。
**变异可行性**：不可。例如把 `token.ts:158-161` 的 `algorithms: ['ES256']` 删掉、或把 `getSigningKeyByKid` 换成不校验 issuer——mock 的 `jwtVerify` 忽略 `verifyOpts`，该文件不会红。

### N11 `apps/portal/__tests__/api/oauth-revoke.test.ts` 的 AT 断言只证明"写入黑名单"，不证明"撤销生效"（A2 的行为面，**实测 M4**）

M4（删除 `token.ts:167-170` 的黑名单校验）下该文件 **11 例全绿**：
- `:169`（本 client 的 AT → jti 进黑名单）只调 `isJtiRevoked` 直接读 Redis 键 ⇒ 只要 `revokeJti` 写了键就成立；
- `:182`、`:193` 的"不得撤销"在删除校验后仍为 false。

即：**全仓唯一"撤销后必须被拒"的断言是 `oauth-introspect.test.ts:150`**（M4 下变红）。这使该单点成为 H-SESS-006 的唯一安全网——而它正是 §3.2 里"无真实 Redis 时天然为真"的两条之一（**单点 + 条件性失效**，风险叠加）。
**变异可行性**：若要证明撤销生效，必须新增"用已撤销 AT 调受保护端点 → 401"的断言；当前形态下该文件的 AT 断言对"校验是否被读取"不可变异验证。

### N12 `apps/portal/__tests__/api/gateway-identity-trust.test.ts:235-247` —— 回退自验签分支的验签由 mock 驱动（A1 局部，B 类文件内）

该文件整体是高价值（真实 HMAC + 与 Rust 侧同向量 `:108`），但 `:235-247`"无 Gateway 头 + 有效 Cookie token → 自验签成功"依赖 `:54-56` 的 `verifyAccessToken` mock，`:245-246` 的 `expiresAt === 123`/`issuedAt === 100` 就是 mock claims 的映射结果。
**变异可行性**：仅"删除回退分支"可变红；验签本身不可。

### N13 `apps/portal/__tests__/api/user-api.test.ts:82` 等三处 —— 制造"Redis 永久不可用"世界，激活生产不可达的 fail-close（A5 潜伏）

`getRedis: vi.fn(() => null)`（`user-api.test.ts:82`、`me-endpoints.test.ts:44`）与 `getRedis: vi.fn()`（`authz-surface.test.ts:21`）使 `revoke.ts:45` 的 `if (!redis) return true` 成为**唯一路径**。这三个文件当前不断言 jti，故为潜伏；但只要有后人往里加一条"撤销后应被拒"的断言，它就会在该环境下天然为真。
**变异可行性**：不可（在被 mock 的 Redis 下，`revoke.ts:45` 之后的生产代码一行都不执行）。

---

## 5. 变异验证可行性（Q4）

### 5.1 已真实执行的变异实验（本机，2026-10-12）

| 编号 | 变异（临时改生产代码，跑完即 `git checkout` 还原） | 覆盖的文件 | 结果 | 结论 |
|---|---|---|---|---|
| **M1** | `apps/portal/src/lib/auth/token.ts:265-273` —— 删掉 `issueRefreshToken` 的 `db.insert(schema.refreshTokens)`（**唯一的真实副作用**） | `oauth2-token` `oauth-grant` `authorization-code-storage` `auth-refresh` | **4 文件 / 44 例全绿** | 证实已知①：`issueRefreshToken` 真实实现零覆盖。**确定假绿**（A1/A2） |
| **M2** | `apps/portal/src/app/api/auth/logout/route.ts:78-86` —— 删掉第 3 层（按 Cookie 撤销 RT） | `auth-logout` | **1 文件 / 6 例全绿** | 证实 N1。**确定假绿**（A5） |
| **M3**（对照） | `apps/portal/src/lib/auth/token.ts:315-320` —— 删掉复用检测触发的家族级联撤销 | `rt-reuse-detection` | **2 例变红**（`AssertionError: expected false to be true`） | 证明本普查的判别力：`rt-reuse-detection.test.ts` **确实**保护真实行为（B 类） |
| **M4** | `apps/portal/src/lib/auth/token.ts:167-170` —— 删掉 `verifyAccessToken` 的 jti 黑名单校验 | `oauth-introspect` `oauth-revoke` `token-claims-binding` `session-lifecycle` | `oauth-introspect` **红 1 例**（`:150`）；`session-lifecycle` **红 1 例**（`:170`）；`oauth-revoke` **11 例全绿**；`token-claims-binding` **18 例全绿** | 证实已知④与 N11：撤销端点的 AT 断言不覆盖"读取黑名单"；`isJtiRevoked` 的 mock 使该文件对该变异完全免疫 |
| **M5** | 无代码变异，只把 `REDIS_URL` 指向死端口（`redis://127.0.0.1:6399`） | 全量 API project | **434 绿 / 3 红**；其中 `oauth-introspect:150`、`oauth-revoke:169` **天然为真** | 证实 §3.2：fail-close 使"撤销有效"变 tautology、"未撤销"变假红 |

复现命令（逐条）：
```bash
# 基线
pnpm test:api                                            # 49 文件 / 437 例全绿
# M5（无真实 Redis）
REDIS_URL=redis://127.0.0.1:6399 npx vitest run --project @auth-sso/portal-api
# M1 / M2 / M3 / M4：先改生产代码，再定向跑
npx vitest run --project @auth-sso/portal-api oauth2-token oauth-grant authorization-code-storage auth-refresh
npx vitest run --project @auth-sso/portal-api auth-logout
npx vitest run --project @auth-sso/portal-api rt-reuse-detection
npx vitest run --project @auth-sso/portal-api oauth-introspect oauth-revoke token-claims-binding session-lifecycle
# 还原
git checkout -- apps/portal/src/lib/auth/token.ts apps/portal/src/app/api/auth/logout/route.ts
```
> 纪律要求（与 `docs/solution/2026-10-08-data-scope-fail-open.md:76-85` 同源）：**M5 表明变异验证的结论依赖 Redis 可用性**——同一条变异在有/无 Redis 下得到相反结论。因此后续"换成真实实现 + 变异验证"的证据记录里**必须标注 Redis 可用性**，否则证据不可复现。

### 5.2 变异验证可行性的逐点判定

| 子码 | 路径数 | 改坏"对应生产代码"后会不会变红 | 依据 |
|---|---|---|---|
| **A1 值即 mock** | 7 | **不会**（唯一能红的变异 = 删除被测代码对 mock 的赋值/调用） | M1（#1/#4/#6）；推演 #14/#17/#23/#34/#41（期望值来自 `mockResolvedValue`/`mockImplementationOnce`/`vi.fn(() => null)`） |
| **A2 只断言调用** | 12 | **不会**（同上） | M2（#10）；M4（#23）；推演其余（`toHaveBeenCalled*` 的语义上限就是"调用是否发生"） |
| **A3 mock 内手写重实现** | 4 | **不会** | 推演：映射/纯函数的唯一实现在 mock factory 内（#11/#19/#28/#39，均附源码对照） |
| **A4 幽灵键 / 陈旧形状** | 17 | **不会，且不可验证**——没有对应的生产代码存在 | `lib/auth/index.ts:16-21`、`lib/audit.ts:56-243` 导出清单、`verify-jwt.ts:23-32`、`permissions.ts:116-121`；反向钉死见 `authz-surface.test.ts:25-30` |
| **A5 分支不可达** | 2 | **不会** | M2（#10）；推演 #20 与 §4 N13 |
| **B 疑似** | 36 | **多数会**（断言落真实 DB/真实领域函数） | M3 对照：`rt-reuse-detection.test.ts` 的家族撤销断言在变异下变红 |

### 5.3 无法用变异验证的点位及原因（清单）

| 点位族 | 原因 | 可替代的验证手段 |
|---|---|---|
| **全部 A4（17 处）** | 没有对应的生产代码可改坏——mock 声明的是已删除/从不存在的导出或旧返回形状 | **静态键集/形状比对守卫**（扩展 `mock-contract.test.ts`：把 `Function.length` 扩为"mock 的键集 ⊆ 真实模块的键集"+"判别式联合的 `kind` 判别存在"） |
| **全部 A2（12 处）** | 断言的对象是"调用是否发生"，被 mock 的模块行为在测试进程内不存在 ⇒ 任何针对该行为的变异都没有信号通路 | 把安全语义（jti 写入、RT 撤销、权限预填充）**下沉成可断言的返回值**（先例：`revoke.ts:86-91` 的 `UserRevokeOutcome`、`permissions.ts:34-44` 的 `RefreshOutcome`、ADR-017 §2 的判别式失败） |
| **A1 中的"值即 mock"传递断言**（`oauth2-token.test.ts:168`、`auth-login.test.ts:151`、`force-logout-route.test.ts:111`） | 唯一可红入口是"删除写入/传递语句"，属传输层而非业务语义 ⇒ 对业务缺陷不可变异验证 | 让被测值来自**真实实现**（如真实 `signLoginSession` + 真实 ES256 验签，`token-claims-binding.test.ts` 已给出范式） |
| `session-lifecycle.test.ts` 的**验签**半边（§4 N10） | mock 的 `jwtVerify` 忽略 `verifyOpts`/公钥参数，改坏 `token.ts` 对 jose 的用法不产生信号 | 用真实 `generateKeyPair`/`jose`（`oauth-introspect.test.ts:72-81`、`oauth-revoke.test.ts:90-98`、`token-claims-binding.test.ts:72-80` 已是范式） |
| `permission-enforcement.test.ts:486-506`（Redis 降级/熔断） | mock 的 Redis 永不抛错，且 `@/lib/permissions` 被整体替换 ⇒ 生产降级路径不参与 | 复制 `brute-force.test.ts:12-13,32-38` 的**可抛错** fake |
| `health.test.ts` 的 healthy 判定 | `db.execute`/`redis.ping` 都是 mock，健康判定完全由 mock 返回值决定；"unhealthy" 用例同理 | 真实探针测试（对照 `docs/solution/2026-07-27-health-check-active-dependency-probes.md` 的取向） |
| **无真实 Redis 环境下的 jti 断言**（`oauth-introspect:150`、`oauth-revoke:169`） | 同一变异在 Redis 可用/不可用下结论相反（M4 vs M5） | 先在 `vitest.globalSetup.ts` 加 Redis 硬断言（对照 `:86-91` 的 PostgreSQL 做法），再记录变异证据并**标注环境** |

---

## 6. 形态统计与治理含义

### 6.1 形态分布（决定规则怎么写比规则写多严更重要）

| 形态 | 出现次数 | 归类 | 典型点位 | 机械规则的处置 |
|---|---|---|---|---|
| `vi.mock` 内**手写重实现**被替换模块 | 4 | A3 | `permission-enforcement.test.ts:94-95`、`user-role-api.test.ts:33-45`、`user-api.test.ts:57-71`、`auth-logout.test.ts:131-135` | 应直接禁止（不是"需要理由"，而是"理由永远不成立"） |
| **幽灵键 / 陈旧返回形状** | 17（幽灵键 14 + 陈旧形状 4，1 行重叠） | A4 | §2.1 #25/#27–#33/#35–#38/#40/#42（幽灵键）、#2/#5/#18/#24（陈旧形状） | 静态契约守卫（mock 键集 ⊆ 真实导出集 + 判别式 `kind` 存在性）比"理由注解"更合适 |
| **模块被整体替换、断言只剩调用** | 12 | A2 | §2.1 #3/#6–#9/#12/#13/#15/#16/#21/#22/#26 | 需要理由注解 + 安全语义下沉为可断言返回值 |
| **断言的期望值即 mock 产物** | 7 | A1 | `oauth2-token.test.ts:168`、`oauth-grant.test.ts:151-153`、`role-api.test.ts:152-159`、`user-api.test.ts:157-163`、`force-logout-route.test.ts:111` | 同上；应优先换成真实实现 |
| **mock 让被测分支不可达** | 2 | A5 | `auth-logout.test.ts:129`、`force-logout-route.test.ts:65` | 直接禁止（该 mock 使被测承诺无法成立） |
| **仅为旁路鉴权 / 提供输入** | 36 | B | CRUD 与 actions 文件（§2.2） | 理由注解即可（"旁路鉴权，鉴权另有覆盖"） |

### 6.2 与票据 #27 已知事实的对照

| #27 的已知事实 | 本次普查的裁定 |
|---|---|
| 轮换 / 重放检测 / 家族级联撤销**已由真实实现覆盖**（`rt-reuse-detection.test.ts:107-123`） | ✅ **成立**，且 M3 提供了反证：该文件对同一处变异**会**变红。假绿是局部而非全景——B 类 36 处里绝大多数断言是真实 DB/真实领域函数 |
| 假绿集中在 4 处 | ❌ **偏低**：本次判为 A 类 42 处。其中属于"同一形态的不同实例"是主要增量（幽灵键 14、只断言调用 10、手写重实现 4、值即 mock 11、分支不可达 3） |
| 真实 Redis 基线实际不存在；`vitest.globalSetup.ts:63-127` 只探 PostgreSQL | ✅ **成立**；本次把影响量化为"2 条天然为真 + 3 条假红"（M5） |
| 最硬阻碍：jsdom 29.1.1 的 `Crypto` 无 `subtle`，真 ES256 无法在 UI project 内运行 | ✅ 与本次观察一致：三个能做真实验签的文件（`oauth-introspect` / `oauth-revoke` / `token-claims-binding`）**全部在 API project**（`// @vitest-environment node`），UI project 内 20 个文件零 `jose` 真实使用 |

### 6.3 需要显式决策的边界（本次不得不做判断的地方）

1. **`@/lib/env`（8）/ `@/lib/logger`（1）算不算生产业务模块？** 本次按"配置 / 日志 = 基础设施"归入 C。若按 `@/lib/**` 的字面 glob，它们会把 A/B 总数从 78 抬到 87。**建议规则明写这两条豁免**，否则守卫会对 6 个 `importOriginal` 式的最小覆盖产生噪声（先例：这些 mock 的存在理由与 `next/headers` 同级）。
2. **`@/hooks/use-permissions`（1）、`@/components/ui/*`（3）** 也是生产代码但不在 `@/lib|@/domain|@/app` 内。`permission-guard.test.tsx:20-22` 把 `hasPermission` 换成 `vi.fn(() => true)`，与 A 类同形。
3. **`@auth-sso/contracts`（1）/ `@auth-sso/config`（1）** 属"枚举值唯一真相源"，mock 它们等于替换规范本身；本次判 C，但 `contracts` 的 mock 用的是 `importOriginal` 透传，风险为零。
4. **Rust 侧（`apps/gateway`，15 个含测试文件）不在本次射程**。若守卫规则只以 Vitest 形态落地，Rust 侧的同类形态（例如整体替换式的 test double）不会被覆盖；跨语言契约目前只靠 `gateway-identity-trust.test.ts:11-17` 与 `apps/gateway/src/http.rs` 的同向量测试锚定。

---

## 未验证条目

1. **未逐字核对** `docs/spec/REQUIREMENTS_MATRIX.md` 中 H-SESS-006 / H-ACL-002 / H-PERM-004 的原文验收措辞；本次对"安全语义"的引用均来自源码注释与 ADR，未回溯到需求条目本身。
2. **未跑 Playwright E2E**（3 个 spec）。`docker-release.spec.ts` 的默认跳过已由 `playwright.config.ts:9` 的配置证实，但"跳过是否等价于该闭环在 CI 中零覆盖"取决于 CI 是否显式设 `E2E_TARGET=docker`（未查 `.github/workflows/`）。
3. **未对 UI project 的 20 个文件做变异实验**（本次 M1–M4 全在 API project）。UI project 的 A/B 结论（`audit-logs.test.tsx` 的 2 处）仅由源码对照得出。
4. **未核实 `vitest.ui.config.ts` 下 `src/**/*.test.*` 的运行环境**对 `db/index.test.ts` / `env.test.ts` / `server-error.test.ts` 的具体影响（它们无 `@vitest-environment node` 覆盖，运行在 jsdom 下；实测通过，但"在 jsdom 下通过"是否等于"在 node 下也通过"未验证）。
5. **`change-password.test.ts` 在 M5（无 Redis）下耗时 11.6s**，接近 `vitest.base.ts:12` 的 `testTimeout: 10_000`；未确认是个别用例逼近超时还是统计口径问题。
6. **未统计 A 类对安全需求的覆盖缺口**（例如"删除 `revoke.ts` 的死分支"是否影响 H-SESS-006 的验收），属后续票据而非本普查范围。
7. `apps/gateway` 的 Rust 测试**未运行**（`cargo test` 不在本次范围）。

## 参考来源

**仓库内一手来源（源码 / 配置 / 历史）**
- `apps/portal/vitest.globalSetup.ts:63-127`（只探 PostgreSQL）、`apps/portal/vitest.api.config.ts:12-24`、`apps/portal/vitest.ui.config.ts:16-29`、`vitest.base.ts:10-19`、`vitest.config.ts:10-24`
- `apps/portal/vitest.setup.ts:12-31`（全局 `server-only` / `next/cache` / `next/headers` mock）
- `apps/portal/src/lib/session/revoke.ts:28-53,86-91,100-128,137-188`
- `apps/portal/src/lib/permissions.ts:34-44,116-121,143-146,151,176-253,266-270,279-295,301-313`
- `apps/portal/src/lib/auth/token.ts:132-177,255-276,298-382,395-407`
- `apps/portal/src/lib/auth/oauth-grant.ts:161-177`
- `apps/portal/src/lib/auth/index.ts:14-24`
- `apps/portal/src/lib/auth/verify-jwt.ts:18-32,108-143`
- `apps/portal/src/lib/authz/write.ts`（`withScopedWrite` JSDoc：越界抛 `ForbiddenError`，映射交给调用链）
- `apps/portal/src/lib/audit.ts:56-243`（导出清单）、`apps/portal/src/lib/crypto.ts:7-130`
- `apps/portal/src/app/api/auth/logout/route.ts:4-8,36-116`
- `apps/portal/src/app/api/auth/oauth2/introspect/route.ts:44-64`
- `apps/portal/__tests__/helpers/test-db.ts:1-60`（真实 PostgreSQL）、`helpers/mock-factory.ts:104-203`、`helpers/mock-redis.ts`、`helpers/index.ts`
- `playwright.config.ts:9,30-46`
- `docs/adr/ADR-014`（数据范围门面；`:151-157` 撤下原语与契约测试）、`ADR-016`（身份边界形状）、`ADR-017`（深 module 与判别式失败）、`ADR-018`（故障分级）、`ADR-019`、`ADR-020`
- `docs/solution/2026-10-08-data-scope-fail-open.md:76-85,103-121`（变异验证纪律、测试把缺陷固化成规范）
- `docs/archive/solutions/2026-07-09-test-mock-strategy.md:8-14,36-51,59-64`（历史方案：Proxy mock 的验证能力不足、17/17 迁移目标）
- `AGENTS.md:114-122`（测试体系声称）、`CLAUDE.md:34-60`（分层与 Session 架构）
- Git 历史：`ad530d6`、`d685c46`、`a7fa3cb`（三次"把永不失败的调用当失败信号"的修复）

**实测记录（本机，2026-10-12）**
- 基线：`pnpm test:api` → 49 文件 / 437 例全绿；`--project @auth-sso/portal-ui --project @auth-sso/contracts` → 27 文件 / 207 例全绿
- M1 / M2 / M3 / M4 / M5 的逐条命令与结果见 §5.1
- 环境：Node v26.10.0、pnpm 10.12.4、`auth-sso-postgres` / `auth-sso-redis` 容器 healthy
