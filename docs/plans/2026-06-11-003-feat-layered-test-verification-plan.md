---
type: feat
status: active
created: 2026-06-11
origin: docs/brainstorms/2026-06-11-layered-verification-strategy-requirements.md
---

# feat: 分层测试验证体系建设

## Summary

建立覆盖 E2E → API 单元 → 组件 → 需求追溯 → CI 的五层测试验证体系。基于已就位的 Vitest + Playwright + RTL 基础设施，补齐 DB Mock 层和 E2E 播种，迁移旧 `/tests/` 17 个自定义测试文件的场景到标准框架，实现 `pnpm test` 一键全量执行和需求覆盖率 ≥ 90%。

---

## Problem Frame

当前项目存在三个系统性痛点：

1. **漏 bug** — 代码变更后无自动回归检测，bug 上线后才发现
2. **回归慢** — 每次改动需手动验证大量流程，效率极低
3. **需求遗漏** — 功能完成后缺乏系统化手段确认需求覆盖

根因：DB Mock 基础设施缺失导致 27/29 Portal API 路由无法单元测试；E2E 无数据库播种导致 Playwright 测试不可运行；无 CI 流水线导致测试不被自动执行。

---

## Scope Boundaries

### In Scope

- DB Mock 层（`createMockDb()`）及扩展 Mock 工具
- 29 个 Portal API 路由 + 3 个 IdP API 路由的 Vitest 单元测试
- 7 个 Portal 核心 UI 组件的 RTL 测试
- 9 个 Playwright E2E spec 覆盖全部用户流程
- REQUIREMENTS_MATRIX 扩展（新增模块 H：认证与 Session）
- 需求追溯脚本 `tests/traceability/generate-report.mjs`
- GitHub Actions CI 工作流（PR 检查 + main 全量）
- 旧 `/tests/` 17 个文件场景迁移后删除

### Deferred for Later

| 排除项 | 原因 |
|---|---|
| 性能/压力测试 | 非当前痛点，现有 `performance.test.js` 保留为独立脚本 |
| 视觉回归测试（截图对比） | 维护成本高，ROI 不够 |
| 跨浏览器测试 | 仅 Chromium 降低复杂度 |
| a11y 可访问性测试 | 独立需求，不在本次范围 |
| IdP 和 Demo App 的组件测试 | IdP 页面少，Demo App 极简，ROI 不够 |

### Deferred to Follow-Up Work

- 性能测试集成到 CI（当前 `performance.test.js` 保留在 `tests/` 但不迁移）
- Percy/Chromatic 视觉回归（当 UI 频繁变更时重新评估）

---

## Key Technical Decisions

### KT1: DB Mock 策略 — 基于 Drizzle 查询链的 Spy 模式

**决策:** 构建 `createMockDb()` 工厂，返回可配置的 spy 对象，支持 `select().from().where().limit().offset().orderBy()` 链式调用的返回值注入。

**依据:** Drizzle ORM 查询是链式构建器模式（query builder），每个方法返回新的查询对象。直接 mock `@/lib/db` 模块的 `db` 导出，用 `vi.fn()` 模拟链上每个方法，允许测试注入任意返回值。这与现有 `MockRedisStore` 模式一致——保留接口但用可控实现替换。

**替代方案被拒绝:** 使用真实 PostgreSQL 的集成测试（启动成本高，CI 复杂度大）；使用 `better-sqlite3` 内存数据库（Drizzle 不原生支持 SQLite 的 schema 迁移）。

### KT2: IdP 授权逻辑提取 — 可测试函数分离

**决策:** 将 `oauth2/authorize/route.ts` 中的用户状态检查和应用准入逻辑提取到 `apps/idp/src/lib/oauth-authorize-check.ts` 作为纯函数导出，路由 handler 仅做参数组装和 HTTP 响应。

**依据:** 当前逻辑嵌入在 `toNextJsHandler(auth)` 的处理流程中，无法独立测试。提取后单元测试可直接验证 5 个准入分支（ACTIVE 用户、非 ACTIVE 阻止、管理员绕过、role_clients 准入、无绑定拒绝），E2E 层补充端到端验证。这是安全核心（G-SEC-INT）的最低测试保障。

### KT3: REQUIREMENTS_MATRIX 扩展 — 新增认证/Session 模块

**决策:** 在 `REQUIREMENTS_MATRIX.md` 新增「模块 H: 认证与身份生命周期」，定义 `H-AUTH-*` 和 `H-SESS-*` ID，与现有 `@req` 注释对齐。

**依据:** 用户选择「扩展矩阵」方案。现有测试使用 `AUTH-xxx`/`SESS-xxx` ID，但矩阵中无对应条目。扩展后追溯脚本可统一解析，覆盖报告不丢失认证模块的覆盖信息。

### KT4: 组件测试 API Mock — Mock Hook 层而非 HTTP 层

**决策:** 组件测试通过 mock 数据获取 hooks（如 `usePermissions`、`useMenus`）返回可控数据，而非引入 MSW 拦截 fetch。

**依据:** Portal 组件通过自定义 hooks 获取数据，非直接 fetch。Mock hook 返回值比引入 MSW 更简单、更快速，且与现有 `createMockWithPermission` 模式一致。不引入新的测试依赖（避免 package.json 膨胀）。

### KT5: E2E 播种时机 — Playwright webServer command 前缀

**决策:** 在 `playwright.config.ts` 的 IdP webServer 的 `command` 中添加 `pnpm db:seed &&` 前缀。

**依据:** Playwright 的 `webServer` 配置在测试前自动启动服务，`reuseExistingServer: true` 在开发模式下复用。播种作为 IdP 启动的前置步骤，确保每次 CI 运行都有干净的测试数据。这与旧 `start-services.sh` 的做法一致。

---

## System-Wide Impact

| 影响方 | 影响 |
|---|---|
| **开发者** | `pnpm test` 一键全量测试，`pnpm test:report` 查看需求覆盖 |
| **Code Reviewer** | PR 提交自动触发 API + 组件测试，失败不可合并 |
| **CI/CD** | 新增 `.github/workflows/`，需配置 Branch Protection |
| **测试数据** | `apps/idp/scripts/seed.ts` 需包含 E2E 测试所需的种子数据 |
| **旧测试资产** | `/tests/` 17 个文件场景迁移后删除，`/tests/runner.js` 废弃 |

---

## Implementation Units

### Phase 1: Foundation

### U1. DB Mock 基础设施 + 扩展 Mock 工具 + REQUIREMENTS_MATRIX 扩展

- **Goal:** 补齐当前缺失的 DB Mock 层，使 27 个未测试的 API 路由可进行单元测试；扩展 Mock 工具集；扩充 REQUIREMENTS_MATRIX 以涵盖认证/Session 模块
- **Requirements:** 技术约束「API 单元测试独立于运行中的服务」
- **Dependencies:** 无（已有 mock 基础设施为前置）
- **Files:**
  - Create: `apps/portal/__tests__/helpers/mock-db.ts`
  - Create: `apps/idp/__tests__/helpers/` (目录 + `index.ts`, `mock-db.ts`, `mock-auth.ts`)
  - Modify: `apps/portal/__tests__/helpers/test-utils.ts` (新增 `mockFetch` 工厂)
  - Modify: `apps/portal/__tests__/helpers/index.ts` (导出新工具)
  - Modify: `docs/spec/REQUIREMENTS_MATRIX.md` (新增模块 H)
  - Test: `apps/portal/__tests__/helpers/helpers.test.ts` (扩展以覆盖新 mock 工具)
- **Approach:**
  - `createMockDb()` 工厂：返回 `{ db: { select, selectDistinct, insert, update, delete, execute, transaction }, schema }` ，其中 `select()` 和 `selectDistinct()` 均返回带 `from().where().limit().offset().orderBy().innerJoin().leftJoin()` 链的 spy（`select()` 支持零参数和列投影 `select({col: table.field})` 两种调用方式），每个方法可配置返回值；`insert().values().returning()` 返回可配置的插入结果；`update().set().where().returning()` 同理；`execute()` 接收原始 SQL 模板返回可配置的行集；`transaction()` 接收回调并传入与外部 `db` 相同接口的 `tx` 对象
  - `mockFetch()` 工厂：接收 `{ responses: Map<url, Response> }` 配置，返回 `vi.spyOn(globalThis, 'fetch')` 的 mock 实现，支持 JSON 响应、错误响应、网络错误三种模式
  - IdP mock helpers：从 Portal helpers 移植模式，适配 IdP 的 Better Auth mock 需求
  - REQUIREMENTS_MATRIX 扩展：新增「模块 H: 认证与身份生命周期」，包含 H-AUTH-001~005 (OAuth 流程)、H-AUTH-010~014 (安全验证)、H-SESS-001~022 (Session 生命周期)、H-SSO-001~011 (SSO 流程)
- **Patterns to follow:**
  - `apps/portal/__tests__/helpers/mock-redis.ts` — `createMockRedis()` 的 Map-based 工厂模式
  - `apps/portal/__tests__/helpers/mock-auth.ts` — `createMockWithPermission()` 的可配置行为模式
- **Test scenarios:**
  - `createMockDb().db.select().from().where()` 返回配置的 mock 数据
  - `createMockDb().db.insert().values().returning()` 返回插入结果
  - `createMockDb().db.transaction()` 执行回调并返回其结果
  - `mockFetch()` 对匹配 URL 返回配置的 JSON 响应
  - `mockFetch()` 对不匹配 URL 返回网络错误
  - REQUIREMENTS_MATRIX 模块 H 包含 H-AUTH-*、H-SESS-* 和 H-SSO-* 三个子族
- **Execution note:** 实现新工具 test-first — mock 工具本身需要验证正确性
- **Verification:** `pnpm --filter @auth-sso/portal test` 包含 helpers.test.ts 全绿，新 mock 工具覆盖率 100%

### U2. E2E 播种集成 + IdP 授权逻辑提取

- **Goal:** Playwright E2E 测试启动时自动播种数据库；将 IdP OAuth 授权逻辑提取为可单元测试的纯函数
- **Requirements:** G-SEC-INT（SSO 强拦截），技术约束「E2E 测试需要全套服务运行」
- **Dependencies:** U1 (DB mock 用于测试提取后的 IdP 函数)
- **Files:**
  - Modify: `playwright.config.ts` (IdP webServer command 添加 `db:seed` 前缀)
  - Create: `apps/idp/src/lib/oauth-authorize-check.ts` (提取授权检查逻辑)
  - Modify: `apps/idp/src/app/api/auth/oauth2/authorize/route.ts` (调用提取的函数)
  - Create: `apps/idp/__tests__/api/oauth-authorize.test.ts` (授权逻辑单元测试)
  - Modify: `apps/idp/scripts/seed.ts` (确保 E2E 所需种子数据完整)
- **Approach:**
  - Playwright config: IdP webServer 的 `command` 改为 `pnpm db:seed && pnpm --filter @auth-sso/idp dev -p 4101`；在 `globalSetup` 或 IdP webServer 就绪后验证种子数据存在
  - 授权逻辑提取：从 route.ts 中提取 `checkUserAuthorization(user, clientId)` 函数，接受用户状态 + client_id，返回 `{ allowed: boolean, reason?: string }`。覆盖 5 个分支：ACTIVE 用户放行、非 ACTIVE 拒绝、管理员绕过 role_clients、有 role_clients 绑定放行、无绑定拒绝
  - 种子数据确认：确保 seed.ts 创建 E2E 测试所需的 admin 用户、测试 client、基础角色和权限
- **Patterns to follow:**
  - `apps/portal/src/lib/auth-middleware.ts` — `checkPermission()` 的纯函数提取模式
  - `apps/idp/src/lib/auth.ts` — IdP 侧的服务组织方式
- **Test scenarios:**
  - `checkUserAuthorization` 对 ACTIVE 用户 + 有效 client 返回 allowed
  - `checkUserAuthorization` 对 LOCKED/DELETED 用户返回 not allowed
  - `checkUserAuthorization` 对管理员用户绕过 role_clients 检查返回 allowed
  - `checkUserAuthorization` 对普通用户无 role_clients 绑定返回 not allowed
  - `checkUserAuthorization` 对普通用户有 role_clients 绑定返回 allowed
  - Playwright webServer 启动后种子数据可查询
- **Execution note:** IdP 授权逻辑提取采用 test-first — 先写测试定义 5 个分支的预期行为，再提取实现
- **Verification:** `pnpm --filter @auth-sso/idp test` 全绿；`pnpm db:seed && pnpm --filter @auth-sso/idp dev` 启动后可查询到种子用户

---

### Phase 2: API 单元测试

### U3. 用户 + 角色 API 测试

- **Goal:** 覆盖 Portal 用户管理（4 路由）和角色管理（5 路由）的全部业务逻辑
- **Requirements:** B-USR-L/S/C/R/U/D/ST, C-ROL-L/C/U/D/PA/CA/DS, SCOPE-001~005
- **Dependencies:** U1 (DB mock, mockFetch)
- **Files:**
  - Create: `apps/portal/__tests__/api/user-api.test.ts`
  - Create: `apps/portal/__tests__/api/role-api.test.ts`
- **Approach:**
  - 用户 API：测试 GET 列表（分页、搜索、状态过滤、数据范围过滤）、POST 创建（字段校验、唯一性检查、部门范围验证）、GET [id]（public_id 查找、数据范围检查）、PUT [id]（状态变更触发 session 撤销）、DELETE [id]（逻辑删除 + session 撤销）、roles 子路由（角色分配/取消）
  - 角色 API：测试 GET 列表、POST 创建（含数据范围类型选择）、PUT [id]（含系统角色保护）、DELETE [id]、permissions 子路由（权限绑定/解绑）、clients 子路由（应用授权）、data-scopes 子路由（数据范围配置 CRUD）
  - 所有测试使用 `createMockDb()` 注入查询结果，`createMockWithPermission()` 模拟认证，审计 mock 验证 `logAuditEvent` 调用
- **Patterns to follow:**
  - `apps/portal/__tests__/api/session-lifecycle.test.ts` — API 测试结构：describe 分组、beforeEach 清理、环境注解
  - `apps/portal/__tests__/api/auth-callback.test.ts` — fetch mock 模式和错误路径覆盖
- **Test scenarios:**
  - Happy: GET /api/users 返回分页用户列表，含 total 和 page 信息
  - Happy: POST /api/users 成功创建用户，返回 public_id
  - Happy: GET /api/roles 返回角色列表，含 dataScopeType
  - Happy: POST /api/roles 创建角色含 permissions 绑定
  - Edge: GET /api/users 关键词搜索过滤空结果
  - Edge: POST /api/users 重复邮箱返回冲突错误
  - Edge: PUT /api/roles/[id] 修改系统角色（isSystem=true）返回禁止
  - Error: GET /api/users 无权限返回 403
  - Error: POST /api/users 缺少必填字段返回 400
  - Error: DELETE /api/users/[id] 对不存在的用户返回 404
  - Integration: PUT /api/users/[id] 状态变更后触发 revokeUserSessions
  - Integration: POST /api/roles 后 audit log 记录创建事件
- **Verification:** `pnpm test:api` 中 user-api 和 role-api 全绿，覆盖旧 `tests/auth.test.js` 和 `tests/permission.test.js` 中用户/角色相关场景

### U4. 部门 + 数据范围 API 测试

- **Goal:** 覆盖 Portal 部门管理（4 路由）和数据范围过滤逻辑（5 种类型）
- **Requirements:** F-DEP-L/C/U/D, SCOPE-001~005
- **Dependencies:** U1 (可与 U3 并行)
- **Files:**
  - Create: `apps/portal/__tests__/api/department-api.test.ts`
  - Create: `apps/portal/__tests__/api/data-scope.test.ts`
- **Approach:**
  - 部门 API：测试 GET 列表（数据范围过滤 + 树形构建）、POST 创建、GET [id]（含 members 子路由）、PUT [id]（循环引用检测）、DELETE [id]（子部门保护）。循环检测逻辑（while 循环追溯祖先）需要重点测试
  - 数据范围：独立测试 `getDataScopeFilter()` 和 `checkDataScope()` 函数，覆盖 ALL/SELF/DEPT/DEPT_AND_SUB/CUSTOM 五种类型。验证 `DEPT_AND_SUB` 的递归 CTE 查询、异常降级行为
- **Patterns to follow:**
  - `apps/portal/src/lib/auth-middleware.ts` — `getDataScopeFilter()` 和 `checkDataScope()` 的实际实现
  - `apps/portal/__tests__/api/session-lifecycle.test.ts` — 工具函数独立测试模式
- **Test scenarios:**
  - Happy: GET /api/departments 返回树形结构含 children 嵌套
  - Happy: POST /api/departments 创建子部门成功
  - Happy: `getDataScopeFilter` ALL 类型返回空过滤条件
  - Happy: `getDataScopeFilter` DEPT 类型返回 eq(deptId, userDeptId)
  - Edge: PUT /api/departments/[id] 将父部门设为自己返回循环引用错误
  - Edge: DELETE /api/departments/[id] 存在子部门时拒绝删除
  - Edge: `getDataScopeFilter` DEPT_AND_SUB 异常时降级为严格 deptId 比对
  - Edge: `checkDataScope` SELF 类型下用户访问自己的数据通过
  - Edge: `checkDataScope` SELF 类型下用户访问他人的数据拒绝
  - Error: POST /api/departments 缺少必填字段返回 400
  - Integration: GET /api/departments 数据范围 CUSTOM 返回预设部门数据
- **Verification:** `pnpm test:api` 中 department-api 和 data-scope 全绿，覆盖旧 `tests/department.test.js` 和 `tests/data-scope*.test.js` 全部场景

### U5. Client + Menu + Permission API 测试

- **Goal:** 覆盖 Portal Client 管理、Menu 管理和 Permission 管理的 API 业务逻辑
- **Requirements:** G-CLT-L/C/U/D, E-MNU-L/C/U/D/PB, D-PRM-L/C/U/D
- **Dependencies:** U1 (可与 U3/U4 并行)
- **Files:**
  - Create: `apps/portal/__tests__/api/client-api.test.ts`
  - Create: `apps/portal/__tests__/api/menu-api.test.ts`
  - Create: `apps/portal/__tests__/api/permission-api.test.ts`
- **Approach:**
  - Client API：测试 CRUD、Secret 轮换（仅在创建时返回完整 secret）、Token 撤销。Redirect URI 验证逻辑
  - Menu API：测试树形 CRUD、权限绑定、可见性控制、递归删除
  - Permission API：测试 CRUD、权限注册路由（`/api/permissions/register` — Basic Auth + 权限树扁平化 + 两阶段事务写入 + 父 ID 回填 + 软删除）。注册路由是代码库中最复杂的路由
- **Patterns to follow:**
  - `apps/portal/src/app/api/permissions/register/route.ts` — 现有实现作为测试参考
  - `apps/portal/src/app/api/clients/[id]/secret/route.ts` — Secret 轮换模式
- **Test scenarios:**
  - Happy: POST /api/clients 创建 client 返回 client_id 和 secret（仅一次）
  - Happy: POST /api/clients/[id]/secret 轮换 secret 返回新 secret
  - Happy: GET /api/menus 返回树形菜单含权限绑定
  - Happy: POST /api/permissions 创建新权限标识
  - Happy: POST /api/permissions/register 同步权限树（Basic Auth）
  - Edge: POST /api/clients redirect_uri 含非法格式返回验证错误
  - Edge: DELETE /api/menus/[id] 递归删除子菜单
  - Edge: POST /api/permissions/register 两阶段事务中新权限插入+旧权限软删除
  - Error: POST /api/clients/[id]/secret 对不存在的 client 返回 404
  - Integration: Client 创建后 audit log 记录事件
- **Verification:** `pnpm test:api` 中 client-api、menu-api、permission-api 全绿

### U6. 横切关注点 + IdP API 测试

- **Goal:** 覆盖权限强制执行、审计日志、Me 端点、SSO 安全及 IdP 授权/登出 API
- **Requirements:** PERM-001~022, AUTH-001~023, SESS-*, SEC-001~031, H-AUTH-*, H-SESS-*, H-SSO-*
- **Dependencies:** U1, U2 (IdP 授权函数已提取)
- **Files:**
  - Create: `apps/portal/__tests__/api/permission-enforcement.test.ts`
  - Create: `apps/portal/__tests__/api/audit-logging.test.ts`
  - Create: `apps/portal/__tests__/api/me-endpoints.test.ts`
  - Create: `apps/portal/__tests__/api/sso-security.test.ts`
  - Create: `apps/idp/__tests__/api/sign-out-sso.test.ts`
  - Modify: `apps/idp/__tests__/api/oauth-authorize.test.ts` (U2 创建，本单元可能补充场景)
- **Approach:**
  - permission-enforcement：测试 `withPermission()` 中间件的各种拒绝模式（无权限、requireAll 模式、角色检查）、`checkDataScope()` 的准入拒绝
  - audit-logging：测试 `logAuditEvent` 在各种写操作中的调用（含参数正确性）、审计日志查询的分页保护（`pageSize > 100` 防御）
  - me-endpoints：测试 `/api/me`（Session 验证 + Token 刷新 + 动态菜单构建）、`/api/me/permissions`、`/api/me/menus`
  - sso-security：测试 PKCE 验证、State/Nonce 匹配、Cookie 安全属性、Token 交换安全
  - IdP sign-out-sso：测试 SSO 登出逻辑
- **Patterns to follow:**
  - `apps/portal/src/lib/auth-middleware.ts` — `withPermission()` 实现
  - `apps/portal/__tests__/api/auth-callback.test.ts` — fetch mock + 错误路径覆盖
- **Test scenarios:**
  - Happy: `withPermission` 通过权限检查后执行 handler
  - Happy: GET /api/me 返回用户信息含动态菜单
  - Happy: GET /api/audit/logs 分页返回审计日志
  - Edge: `withPermission` requireAll 模式下缺少任一权限返回 403
  - Edge: 审计日志 pageSize > 100 时重置为 20
  - Edge: PKCE code_verifier 不匹配时 Token 交换失败
  - Error: 未登录访问 /api/me 返回 401
  - Error: 无权限访问受保护路由返回 403
  - Error: 重放已使用的 authorization code 返回错误
  - Integration: /api/me 触发 Token 刷新链（Session → IdP Token → Userinfo）
- **Verification:** `pnpm test:api` 中全部横切测试 + IdP 测试全绿

---

### Phase 3: 组件测试

### U7. 核心交互组件测试

- **Goal:** Portal 核心 UI 组件的渲染与交互验证
- **Requirements:** A-NAV-01 (侧边栏动态渲染), PERM-010~012 (菜单权限)
- **Dependencies:** U1 (mock 工具可用)
- **Files:**
  - Create: `apps/portal/__tests__/components/permission-guard.test.tsx`
  - Create: `apps/portal/__tests__/components/app-sidebar.test.tsx`
  - Create: `apps/portal/__tests__/components/login-content.test.tsx`
  - Create: `apps/portal/__tests__/components/data-table.test.tsx`
- **Approach:**
  - PermissionGuard：测试有权限渲染 children、无权限返回 null、多权限 AND 逻辑
  - AppSidebar：mock `usePermissions` 和 `useMenus` hooks，测试菜单过滤（仅显示有权限项）、展开/折叠交互
  - LoginContent：mock `useSearchParams`，测试表单校验（空邮箱/密码）、登录中状态（按钮 disabled + spinner）、错误提示渲染、SSO 跳转链接
  - DataTable：测试分页控件、排序切换、搜索输入、空状态渲染
  - 组件测试默认使用 jsdom 环境（Portal vitest 配置已设置），mock 数据 hooks 而非 HTTP 层
- **Patterns to follow:**
  - Portal vitest 配置中的 jsdom + React 插件设置
  - `apps/portal/src/components/ui/permission-guard.tsx` — 实际组件实现
  - `apps/portal/src/app/login/login-content.tsx` — 登录表单实现
- **Test scenarios:**
  - Happy: PermissionGuard 有权限时渲染子组件
  - Happy: AppSidebar 根据权限过滤后显示菜单项
  - Happy: LoginContent 正确邮箱格式通过前端校验
  - Edge: PermissionGuard 无权限时返回 null（不渲染）
  - Edge: AppSidebar 无任何菜单权限时显示空状态
  - Edge: LoginContent 空邮箱提交显示校验错误
  - Edge: LoginContent 登录中状态下按钮 disabled 且显示 spinner
  - Edge: DataTable 空数据时显示 empty state
  - Error: LoginContent 提交后收到服务端错误显示红色警告
  - Integration: AppSidebar 展开/折叠触发 onToggle 回调
- **Verification:** `pnpm test:components` 全绿

### U8. 表单对话框组件测试

- **Goal:** Portal 表单对话框组件的交互与校验逻辑验证
- **Requirements:** B-USR-C (新建用户), C-ROL-C (新建角色含数据范围), F-DEP-L (部门树)
- **Dependencies:** U1 (可与 U7 并行)
- **Files:**
  - Create: `apps/portal/__tests__/components/user-form-dialog.test.tsx`
  - Create: `apps/portal/__tests__/components/role-form-dialog.test.tsx`
  - Create: `apps/portal/__tests__/components/department-tree.test.tsx`
- **Approach:**
  - user-form-dialog：测试新建/编辑模式切换、字段校验（邮箱格式、必填项）、部门选择器交互、提交成功/失败处理
  - role-form-dialog：测试数据范围类型选择（5 个选项渲染）、权限树勾选、应用授权多选、提交
  - department-tree：测试节点展开/折叠、选中状态、搜索过滤
  - 使用 `@testing-library/user-event` 模拟用户交互（点击、输入、选择）
- **Patterns to follow:**
  - `apps/portal/src/app/users/` — 用户管理页面组件
  - `apps/portal/src/app/roles/` — 角色管理页面组件
- **Test scenarios:**
  - Happy: user-form-dialog 新建模式提交有效数据触发 onSubmit
  - Happy: role-form-dialog 数据范围下拉包含全部 5 个选项
  - Happy: department-tree 点击展开按钮显示子节点
  - Edge: user-form-dialog 编辑模式预填现有数据
  - Edge: role-form-dialog 未选数据范围提交显示校验错误
  - Edge: department-tree 默认不展开子节点
  - Error: user-form-dialog 提交后服务端返回错误显示在表单
  - Integration: role-form-dialog 权限树勾选 + 应用授权多选完整流程
- **Verification:** `pnpm test:components` 全绿，含全部表单对话框测试

---

### Phase 4: E2E 测试

### U9. 认证 + 安全 E2E 测试

- **Goal:** Playwright 端到端覆盖完整认证流程、跨应用 SSO 和 RBAC 强制执行
- **Requirements:** G-SEC-INT, H-AUTH-*, H-SSO-*, C-ROL-PA, C-ROL-DS
- **Dependencies:** U2 (E2E 播种就位)
- **Files:**
  - Create: `tests/e2e/` (目录)
  - Create: `tests/e2e/auth-flow.spec.ts`
  - Create: `tests/e2e/sso-cross-app.spec.ts`
  - Create: `tests/e2e/rbac-enforcement.spec.ts`
- **Approach:**
  - auth-flow：测试 Portal 未登录跳转 IdP → 登录 → 回调 → Dashboard；登录失败（错误密码）显示错误；登出后受保护页面重定向；Session 过期后重新登录
  - sso-cross-app：跨 3 个 baseURL 测试 Portal 登录后 Demo App 免登；Demo App 登出后 Portal 也需重新登录；IdP Session 清除后所有应用不可访问
  - rbac-enforcement：受限用户登录后菜单隐藏（无权限菜单不可见）、按钮隐藏（无权限操作按钮不可见）、直接访问 API 路由被拦截
  - 每个 test 标注 `@req` ID，使用 `test.describe` 组织套件
- **Patterns to follow:**
  - `docs/spec/TDD-MASTER-PLAN.md` — UI-AUTH/SEC/RBAC 用例规格
  - 旧 `tests/sso.test.js` — SSO 流程参考
- **Test scenarios:**
  - Happy: 未登录访问 Portal → 重定向 IdP → 登录成功 → 回调 Portal Dashboard
  - Happy: Portal 已登录 → 新标签页打开 Demo App → 自动完成认证
  - Happy: 点击退出登录 → 重定向 /login → Demo App 刷新后也需登录
  - Edge: 错误密码登录 → 页面显示错误提示（不跳转）
  - Edge: 受限用户登录 → 侧边栏仅显示有权限的菜单项
  - Edge: 受限用户登录 → 用户管理页面的删除按钮不可见
  - Error: 登出后用旧 Session Cookie 访问 API → 重定向登录页
  - Integration: 全流程含 PKCE、State、Nonce 验证（通过正常登录覆盖）
- **Verification:** `pnpm test:e2e` 中 auth-flow、sso-cross-app、rbac-enforcement 全绿

### U10. 管理功能 E2E 测试

- **Goal:** Playwright 端到端覆盖全部 CRUD 管理功能
- **Requirements:** B-USR-*, C-ROL-*, D-PRM-*, E-MNU-*, F-DEP-*, G-CLT-*
- **Dependencies:** U2, U9 (E2E 基础设施已验证)
- **Files:**
  - Create: `tests/e2e/user-management.spec.ts`
  - Create: `tests/e2e/role-management.spec.ts`
  - Create: `tests/e2e/permission-management.spec.ts`
  - Create: `tests/e2e/menu-management.spec.ts`
  - Create: `tests/e2e/department-management.spec.ts`
  - Create: `tests/e2e/client-management.spec.ts`
- **Approach:**
  - 每个 spec 遵循统一结构：管理员登录 → 导航到管理页 → CRUD 操作 → 验证结果
  - user-management：创建用户、搜索、分页、编辑、状态切换、删除确认
  - role-management：创建角色含数据范围选择、授予权限、应用授权、编辑、删除
  - permission-management：查看权限列表、新增权限标识、编辑、删除
  - menu-management：查看菜单树、新建菜单节点、编辑、删除
  - department-management：查看部门树、新建子部门、编辑、删除（含子部门保护提示）
  - client-management：注册 Client、查看凭据、编辑 Redirect URI、删除
- **Patterns to follow:**
  - 旧 `tests/business.test.js` — 管理功能流程参考
  - 各 Portal 页面组件 — 交互元素选择器参考
- **Test scenarios (每个 spec 的通用模式):**
  - Happy: 管理员创建实体 → 列表中出现新记录
  - Happy: 管理员编辑实体 → 详情页显示更新
  - Happy: 管理员删除实体 → 二次确认后列表不再显示
  - Edge: 列表搜索功能过滤结果
  - Edge: 列表分页切换
  - Integration: 用户创建 → 分配角色 → 角色权限在用户详情中反映
- **Verification:** `pnpm test:e2e` 中全部 6 个管理 spec 全绿，覆盖旧 `tests/` 中业务测试场景

---

### Phase 5: 追溯 + CI

### U11. 需求追溯脚本 + CI 工作流 + 旧测试清理

- **Goal:** 实现 `pnpm test:report` 需求覆盖报告；建立 GitHub Actions CI 流水线；清理旧测试资产
- **Requirements:** 成功标准 2 (覆盖率 ≥ 90%)、成功标准 3 (PR 自动测试)
- **Dependencies:** U3-U10 (所有测试文件就位，追溯脚本需解析 @req 注释)
- **Files:**
  - Create: `tests/traceability/generate-report.mjs`
  - Create: `.github/workflows/pr.yml`
  - Create: `.github/workflows/main.yml`
  - Modify: `package.json` (确认 test:report 脚本正确)
  - Delete: `tests/` 下 17 个旧 .js 测试文件 + `tests/runner.js`
  - Modify: `CLAUDE.md` (更新测试命令和架构说明)
- **Approach:**
  - 追溯脚本：递归扫描 `apps/*/__tests__/` 和 `tests/e2e/`，正则提取 `@req` 注释中的 ID；解析 `REQUIREMENTS_MATRIX.md` 提取全部需求 ID（模块 A-H）；生成映射表；输出 Markdown + Console 两种格式的覆盖报告；支持 `--threshold 90` 参数，覆盖率不足时 exit 1
  - PR workflow (`pr.yml`)：ubuntu-latest，pnpm setup，install + `pnpm test:api` + `pnpm test:components`，超时 5 分钟
  - Main workflow (`main.yml`)：ubuntu-latest + PostgreSQL + Redis service containers，pnpm setup + `pnpm db:push` + `pnpm db:seed` + `pnpm test:e2e` + `pnpm test:report --threshold 90`，超时 20 分钟，上传 Playwright report 为 artifact
  - 旧测试清理：确认 Vitest 测试覆盖旧场景后，删除 `/tests/*.test.js`、`/tests/runner.js`、`/tests/start-services.sh`、`/tests/check-readiness.js`，保留 `tests/e2e/` 和 `tests/traceability/`
  - 更新 CLAUDE.md：新增测试架构章节，移除旧的 `/tests/` 引用
- **Patterns to follow:**
  - `docs/spec/REQUIREMENTS_MATRIX.md` — 需求 ID 格式参考
  - 旧 `tests/test-report.json` — 报告格式参考
- **Test scenarios:**
  - 追溯脚本解析含 `@req B-USR-L` 的测试文件，生成 { 'B-USR-L': ['user-api.test.ts:45'] } 映射
  - 追溯脚本检测到需求 ID 无对应测试时输出「未覆盖」
  - 追溯脚本 `--threshold 90` 下覆盖率 85% 时 exit 1
  - PR workflow 在测试失败时 workflow 标记为 failed
  - Main workflow 上传 Playwright HTML report 为 artifact
- **Verification:**
  - `pnpm test:report` 输出需求覆盖报告，覆盖率 ≥ 90%
  - PR workflow 可手动触发验证（`gh workflow run pr.yml`）
  - 旧 `/tests/` 的 17 个自定义 JS 文件已删除，Vitest/Playwright 覆盖其全部场景
  - `CLAUDE.md` 反映当前测试架构

---

## Dependencies

```
U1 (DB Mock + Tools) ──┬──> U3 (User + Role API)
                       ├──> U4 (Dept + DataScope API)
                       ├──> U5 (Client + Menu + Perm API)
                       ├──> U6 (Cross-cut + IdP API)
                       ├──> U7 (Core Components)
                       └──> U8 (Form Dialogs)
                          
U2 (E2E Seed + IdP Extract) ──> U9 (Auth E2E) ──> U10 (Mgmt E2E)

U3, U4, U5, U6, U7, U8, U9, U10 ──> U11 (Traceability + CI)
```

- U3-U6 之间无依赖，可并行开发
- U7-U8 之间无依赖，可并行开发
- U9 依赖 U2（E2E 播种），U10 依赖 U9（E2E 基础设施验证）
- U11 依赖全部测试文件就位

---

## Risk Analysis

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| Playwright E2E 测试不稳定（flaky） | 中 | 高 | 合理 timeout（30s/操作）、重试机制（`retries: 2`）、测试隔离（每次 seed 干净数据）、避免依赖时序的断言 |
| DB Mock 与真实 Drizzle 行为不一致 | 中 | 中 | 仅 mock 查询构建器接口而非查询结果语义；E2E 层用真实 DB 补偿；helpers.test.ts 自我验证 |
| 种子数据不足以支持全部 E2E 场景 | 中 | 中 | 在 U2 中审查并补全 seed.ts，确保覆盖 admin、受限用户、多种数据范围角色 |
| CI 中 Playwright 浏览器依赖缺失 | 低 | 高 | 使用 `ubuntu-latest` 预装 Chromium；workflow 中添加 `npx playwright install chromium --with-deps` |
| 旧测试场景迁移遗漏 | 中 | 中 | 逐文件对照旧 `/tests/` 中 17 个文件的测试场景清单，确认 Vitest/Playwright 覆盖 |
| 追溯脚本 @req 解析失败（格式不统一） | 低 | 中 | 在 U1 中定义标准 @req 格式，所有测试文件遵循；脚本用宽松正则匹配 |

---

## Success Metrics

1. `pnpm test` 执行三层全部测试，零配置可运行
2. `pnpm test:report` 生成需求覆盖报告，REQUIREMENTS_MATRIX 覆盖率 ≥ 90%
3. PR 提交自动触发 API + 组件测试，失败则不可合并（Branch Protection）
4. 任意一个 REQUIREMENTS_MATRIX 需求点都能在覆盖报告中找到对应测试
5. 旧 `/tests/` 17 个自定义测试文件的场景全部在 Vitest/Playwright 中重新实现
