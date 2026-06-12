# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Auth-SSO is an enterprise unified identity authentication platform implementing SSO (Single Sign-On) with OIDC Provider capabilities. It's a pnpm monorepo containing:

- **apps/portal** - Admin Portal & OIDC Provider (port 4000) - User/role/permission management, Better Auth OIDC Provider, and Dashboard. IDP functionality is fully integrated into Portal.
- **apps/demo-app** - Demo SSO Client (port 4002) - Tests SSO integration
- **apps/gateway** - API Gateway (Rust/Pingora) - ES256 JWKS offline verification, Cookie-to-Bearer transformation
- **packages/contracts** - Shared types, error codes, permission codes, OIDC constants
- **packages/config** - Shared TypeScript/ESLint configuration

## Development Commands

```bash
# Start all apps in development
pnpm dev

# Start specific app
pnpm --filter @auth-sso/portal dev   # Portal on port 4000
pnpm --filter @auth-sso/demo-app dev # Demo on port 4002

# 测试体系 (Vitest + Playwright + Traceability)
pnpm test                  # 全量 Vitest 测试
pnpm test:api              # API 层测试（Mock DB/Redis）
pnpm test:components       # 组件层测试（jsdom）
pnpm test:e2e              # Playwright E2E 端到端测试
pnpm test:report           # 需求追溯性覆盖率报告
pnpm test:report --threshold 90  # 检查覆盖率 >= 90%
```


## Test Architecture

Tests follow a layered strategy — fast, isolated unit tests at the bottom, integration-style API tests in the middle, and full-browser E2E at the top.

### Layer 1: Unit / Component Tests

- **Location**: `apps/*/__tests__/components/`, `apps/*/__tests__/smoke.test.ts`
- **Framework**: Vitest with `jsdom` environment
- **Scope**: Component rendering, user interactions, helper functions
- **Mocks**: All external dependencies (auth, API calls, DB)
- **Run**: `pnpm test:components`

### Layer 2: API Tests

- **Location**: `apps/*/__tests__/api/*.test.ts`
- **Framework**: Vitest with `@vitest-environment node`
- **Scope**: API route handlers — request validation, auth enforcement, CRUD logic, data scope filtering
- **Mocks**: DB via `vi.mock()`, Redis via `@/lib/redis`, auth middleware via `vi.mock('@/lib/auth-middleware')`
- **Run**: `pnpm test:api`

### Layer 3: E2E Tests

- **Location**: `tests/e2e/*.spec.ts`
- **Framework**: Playwright on Chromium
- **Scope**: Full OAuth 2.1 flow, SSO cross-app login/logout, RBAC enforcement in browser
- **Setup**: Two `webServer` entries (Portal + Demo App) with DB push + seed
- **Run**: `pnpm test:e2e`

### Session 架构

由于 IDP 已完全合并进 Portal，系统在本地直接通过 Better Auth 管理会话状态（`better-auth.session_token` Cookie），同时为了兼容原有的无状态架构和外部 OIDC 流程，支持利用 OIDC/JWT 插件在后台校验 `portal_jwt_token`，实现了统一整合。

### Traceability

- **Script**: `tests/traceability/generate-report.mjs`
- **Reports**: `tests/traceability/coverage-report.md`
- **Mechanism**: Scans test files for `@req` annotations (file-level and line-level), matches against `docs/spec/REQUIREMENTS_MATRIX.md`, generates coverage report
- **CI Gate**: `pnpm test:report --threshold 90` (exits 1 if coverage < 90%)

### `@req` Annotation Convention

Every test file SHOULD annotate which requirements it covers:

- File-level (JSDoc block):
  ```
   * @req AUTH-001~005
   * @req D-PRM-L, D-PRM-C, D-PRM-U, D-PRM-D
  ```
- Line-level (inline, for specific test cases):
  ```
  // @req AUTH-001
  it('缺少 code 参数时重定向到登录页', async () => { ... });
  ```

Supported formats:
- Single ID: `@req A-NAV-01`
- Comma-separated: `@req D-PRM-L, D-PRM-C, D-PRM-U, D-PRM-D`
- Range: `@req AUTH-001~005` expands to AUTH-001 ... AUTH-005
- Slash alternation: `@req F-DEP-L/C/U/D` expands to F-DEP-L, F-DEP-C, F-DEP-U, F-DEP-D
- Mixed: `@req F-DEP-L/C/U/D, SCOPE-001~005`

### Key Test Files

- `apps/portal/__tests__/api/auth-callback.test.ts` — OAuth 回调验证
- `apps/portal/__tests__/api/session-lifecycle.test.ts` — Session TTL 与刷新
- `apps/portal/__tests__/api/sso-security.test.ts` — PKCE/State/Nonce 安全
- `apps/portal/__tests__/api/data-scope.test.ts` — 数据范围过滤
- `apps/portal/__tests__/api/permission-api.test.ts` — 权限 CRUD
- `apps/portal/__tests__/api/role-api.test.ts` — 角色 + 权限绑定
- `apps/portal/__tests__/api/user-api.test.ts` — 用户 CRUD
- `apps/portal/__tests__/api/department-api.test.ts` — 部门 CRUD
- `apps/portal/__tests__/api/client-api.test.ts` — OAuth Client CRUD
- `apps/portal/__tests__/api/menu-api.test.ts` — 菜单 CRUD
- `apps/portal/__tests__/api/audit-logging.test.ts` — 审计日志
- `apps/portal/__tests__/api/me-endpoints.test.ts` — 当前用户 API
- `tests/e2e/auth-flow.spec.ts` — E2E 认证流程
- `tests/e2e/sso-cross-app.spec.ts` — E2E 跨应用 SSO
- `tests/e2e/rbac-enforcement.spec.ts` — E2E RBAC 验证

## Tech Stack

- Next.js 16 (Turbopack)
- Better Auth 1.5+ with OIDC Provider plugin
- Drizzle ORM + PostgreSQL
- Redis (ioredis) for session storage
- Tailwind CSS 4
- pnpm workspaces
## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
