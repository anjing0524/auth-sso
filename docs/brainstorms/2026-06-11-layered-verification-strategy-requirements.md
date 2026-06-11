# Auth-SSO 分层验证体系 — 需求文档

**日期:** 2026-06-11
**状态:** Draft
**范围:** 全项目（IdP + Portal + Demo App）

---

## 1. 问题陈述

当前验证存在三个系统性痛点：

1. **漏 bug** — 代码变更后无法自动检测回归，bug 上线后才发现
2. **回归慢** — 每次改动后需要手动验证大量流程，效率极低
3. **需求遗漏** — 功能做完后缺乏系统化手段确认需求点是否全部覆盖

**根因:** 项目无标准测试框架、无 UI 自动化测试、无需求→测试的追溯机制、无 CI 流水线。

---

## 2. 目标

建立一套**固定的、可重复的**分层验证体系，使得：

- 每次代码变更后能**自动检测回归**（漏 bug → 0）
- 核心流程和业务逻辑有**自动化测试保护**（手动回归 → 自动化）
- 一条命令即可**回答需求覆盖情况**（需求遗漏 → 可追溯）

---

## 3. 验证架构

### 3.1 三层测试结构

```
┌─────────────────────────────────────────────┐
│  E2E Layer (Playwright)                     │
│  用户全流程：登录→授权→管理→登出            │
│  覆盖 TDD-MASTER-PLAN UI TDD 全部用例       │
├─────────────────────────────────────────────┤
│  API Unit Layer (Vitest)                    │
│  每个 API route 的业务逻辑边界              │
│  权限拦截 / Data Scope / 输入校验 / 状态机  │
├─────────────────────────────────────────────┤
│  Component Layer (Vitest + RTL)             │
│  Portal 30+ UI 组件渲染与交互               │
│  表单校验 / 权限守卫 / 对话框 / 状态渲染    │
└─────────────────────────────────────────────┘
         ↓ 测试结果
┌─────────────────────────────────────────────┐
│  Requirements Traceability                  │
│  测试 ID → REQUIREMENTS_MATRIX ID 映射      │
│  覆盖报告：已覆盖 / 未覆盖 / 失败           │
└─────────────────────────────────────────────┘
```

### 3.2 与已有资产的关系

| 已有资产 | 处置方式 |
|---|---|
| `docs/spec/REQUIREMENTS_MATRIX.md` (30+ 需求点) | 作为追溯的源头，测试用例必须标注对应 ID |
| `docs/spec/TDD-MASTER-PLAN.md` (UI TDD 规格) | Playwright E2E 用例的直接规格来源 |
| `docs/test-cases.md` (100+ 测试用例) | 参考，API 单元测试的输入来源 |
| `/tests/` (17 个自定义测试文件) | **废弃**，迁移到 Vitest |
| `/tests/runner.js` (自定义测试运行器) | **废弃**，替换为 Vitest + Playwright |

---

## 4. 功能需求

### 4.1 E2E 层 (Playwright)

**工具:** Playwright + Chromium
**目录:** `tests/e2e/`

覆盖以下用户流程（来源: TDD-MASTER-PLAN UI TDD 用例）：

| E2E 套件 | 覆盖流程 | 对应需求模块 |
|---|---|---|
| `auth-flow.spec.ts` | 用户登录、SSO 免登、全域登出 | A-NAV, G-SEC |
| `user-management.spec.ts` | 用户 CRUD、分页、搜索、状态控制 | B-USR-* |
| `role-management.spec.ts` | 角色 CRUD、权限授予、数据范围配置、应用授权 | C-ROL-* |
| `permission-management.spec.ts` | 权限 CRUD | D-PRM-* |
| `menu-management.spec.ts` | 菜单树 CRUD、权限绑定 | E-MNU-* |
| `department-management.spec.ts` | 部门树 CRUD | F-DEP-* |
| `client-management.spec.ts` | OAuth Client CRUD、Secret 管理 | G-CLT-* |
| `rbac-enforcement.spec.ts` | 受限用户视角：菜单隐藏、按钮隐藏、API 拦截 | C-ROL-PA, C-ROL-DS |
| `sso-cross-app.spec.ts` | Portal ↔ Demo App 跨应用 SSO | G-SEC-INT |

**验收标准:**
- 每个 E2E 测试标注至少一个 `REQUIREMENTS_MATRIX` ID
- 覆盖 TDD-MASTER-PLAN 中全部 `UI-AUTH/RBAC/APP/SEC-*` 用例
- 支持 `pnpm test:e2e` 一键执行
- 支持headed（开发调试）和headless（CI）两种模式

### 4.2 API 单元层 (Vitest)

**工具:** Vitest
**目录:** `apps/portal/__tests__/api/` + `apps/idp/__tests__/api/`

覆盖以下业务逻辑（来源: `/tests/` 现有测试 + `test-cases.md`）：

| API 测试套件 | 覆盖范围 | 对应需求 |
|---|---|---|
| `auth-callback.test.ts` | OAuth 回调、Token 交换、Session 创建 | AUTH-001~005 |
| `session-lifecycle.test.ts` | Session 创建、刷新、过期、踢出 | SESS-* |
| `user-api.test.ts` | 用户 CRUD、分页、搜索、状态控制、Data Scope | B-USR-*, SCOPE-* |
| `role-api.test.ts` | 角色 CRUD、权限绑定、数据范围、应用授权 | C-ROL-* |
| `permission-api.test.ts` | 权限 CRUD | D-PRM-* |
| `menu-api.test.ts` | 菜单 CRUD、权限绑定 | E-MNU-* |
| `department-api.test.ts` | 部门 CRUD、树形结构 | F-DEP-* |
| `client-api.test.ts` | Client CRUD、Secret 轮换 | G-CLT-* |
| `data-scope.test.ts` | ALL/SELF/DEPT/DEPT_AND_SUB/CUSTOM 过滤逻辑 | SCOPE-* |
| `permission-enforcement.test.ts` | withPermission 中间件、无权限拒绝 | PERM-* |
| `audit-logging.test.ts` | 审计日志记录 | 所有写操作 |
| `sso-security.test.ts` | PKCE、State 验证、重放防护、Cookie 安全 | SEC-* |

**验收标准:**
- 每个 API 测试标注至少一个 `REQUIREMENTS_MATRIX` ID 或 `test-cases.md` 编号
- 覆盖现有 `/tests/` 中全部 17 个文件的测试场景
- 支持 `pnpm test:api` 一键执行
- 独立运行，无需启动应用服务（mock 外部依赖）

### 4.3 组件层 (Vitest + React Testing Library)

**工具:** Vitest + @testing-library/react + jsdom
**目录:** `apps/portal/__tests__/components/`

覆盖以下 UI 组件：

| 组件测试套件 | 覆盖组件 | 覆盖场景 |
|---|---|---|
| `permission-guard.test.tsx` | `<PermissionGuard />` | 有权限渲染子组件、无权限隐藏 |
| `app-sidebar.test.tsx` | `<AppSidebar />` | 权限过滤菜单项、展开/折叠 |
| `user-form-dialog.test.tsx` | 用户创建/编辑对话框 | 表单校验、提交、错误处理 |
| `role-form-dialog.test.tsx` | 角色创建/编辑对话框 | 数据范围选择、权限勾选 |
| `department-tree.test.tsx` | 部门树 | 展开/折叠、拖拽排序（如有） |
| `data-table.test.tsx` | 通用表格组件 | 分页、排序、搜索 |
| `login-content.test.tsx` | 登录页 | 表单校验、错误提示、提交 |

**验收标准:**
- 关键交互组件（表单、权限守卫、导航）100% 覆盖
- 支持 `pnpm test:components` 一键执行

### 4.4 需求追溯机制

**工具:** 自定义脚本 + Vitest/Playwright reporter
**目录:** `tests/traceability/`

**核心行为:**
- 每个测试用例通过注释或元数据标注 `REQUIREMENTS_MATRIX` ID（如 `// @req B-USR-L`）
- 追溯脚本解析全部测试文件，建立 `需求 ID → [测试用例列表]` 映射
- 生成覆盖报告：
  - **已覆盖（通过）** — 绿色
  - **已覆盖（失败）** — 红色
  - **未覆盖** — 黄色
- 一条命令 `pnpm test:report` 输出需求覆盖状态

**输出格式:**
```
REQUIREMENTS COVERAGE REPORT
═════════════════════════════

模块 A: 门户底座
  ✅ A-NAV-01 侧边栏动态渲染     [E2E: auth-flow/侧边栏渲染]
  ✅ A-NAV-02 智能面包屑          [E2E: auth-flow/面包屑导航]
  ✅ A-NAV-03 指标卡片看板        [E2E: auth-flow/仪表盘加载]

模块 B: 用户管理
  ✅ B-USR-L  用户分页列表        [API: user-api, E2E: user-management]
  ✅ B-USR-S  用户实时搜索        [API: user-api, E2E: user-management]
  ...

模块 G: 应用与安全
  ⚠️  G-SEC-INT SSO 强拦截        [未覆盖]

───────────────────────────────
总计: 30 已覆盖, 1 未覆盖 (96.8%)
```

**验收标准:**
- 覆盖报告精确到 `REQUIREMENTS_MATRIX` 每一行
- 支持在 CI 中运行，覆盖率低于阈值时构建失败
- 支持 Markdown 和 console 两种输出格式

### 4.5 CI 集成 (GitHub Actions)

**触发条件:**
- **PR / Push:** 运行 API 单元测试 + 组件测试（快速反馈，< 3 分钟）
- **Merge to main:** 运行全量测试（含 E2E，< 15 分钟）

**验收标准:**
- GitHub Actions workflow 文件就位
- 测试失败时 PR 不可合并（branch protection）
- 测试报告作为 CI artifact 可下载

---

## 5. 技术约束

| 约束 | 原因 |
|---|---|
| Playwright 仅 Chromium | 降低维护成本，满足当前需求 |
| Vitest 作为唯一单元测试框架 | 与 Next.js/Vite 生态一致，避免多框架 |
| API 单元测试独立于运行中的服务 | 通过 mock 外部依赖（DB、Redis）实现快速执行 |
| E2E 测试需要全套服务运行 | 通过 `docker-compose` + seed 脚本准备环境 |
| 测试标注使用行内注释格式 | 零侵入，不依赖特定 runner plugin |

---

## 6. 不在范围内

| 排除项 | 原因 |
|---|---|
| 性能/压力测试 | 现有 `performance.test.js` 模式够用，非当前痛点 |
| 视觉回归测试（截图对比） | 维护成本高，ROI 不够 |
| 跨浏览器测试 | 仅 Chromium 降低复杂度 |
| a11y 可访问性测试 | 独立需求，不在本次范围 |
| IdP 和 Demo App 的组件测试 | IdP 页面少，Demo App 极简，ROI 不够 |

---

## 7. 成功标准

1. **`pnpm test` 执行三层全部测试**，零配置即可运行
2. **`pnpm test:report` 生成需求覆盖报告**，REQUIREMENTS_MATRIX 覆盖率 ≥ 90%
3. **PR 提交自动触发 API + 组件测试**，失败则不可合并
4. **任意一个 REQUIREMENTS_MATRIX 需求点都能在覆盖报告中找到对应测试**
5. **现有 `/tests/` 17 个自定义测试文件的测试场景全部在 Vitest 中重新实现**

---

## 8. 关键风险

| 风险 | 缓解措施 |
|---|---|
| Playwright E2E 测试不稳定（flaky） | 设置合理的 timeout、重试机制、测试隔离（每次 seed 干净数据） |
| Mock 外部依赖导致测试不真实 | E2E 层使用真实服务补偿，API 层仅 mock DB/Redis 连接 |
| 需求矩阵更新后追溯报告过时 | 追溯脚本每次运行时重新解析，不缓存 |
| 迁移期间新旧测试共存混乱 | 一次性迁移，迁移完成后删除 `/tests/` 旧文件 |

---

## 9. 下一步

→ 使用 `/ce-plan` 生成分层实现计划
