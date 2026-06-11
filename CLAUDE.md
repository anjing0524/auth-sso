# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Auth-SSO 是企业级统一身份认证平台，实现 SSO + OIDC/OAuth 2.1 Provider。pnpm monorepo 结构：

| 应用 | 端口 | 职责 |
|------|------|------|
| **apps/idp** | 4001 | Identity Provider — Better Auth + OIDC Provider 插件，用户认证与 Token 签发 |
| **apps/portal** | 4000 | Admin Portal — 用户/角色/权限/部门/Client 管理，数据仪表盘 |
| **apps/demo-app** | 4002 | SSO Client 演示 — 端到端验证 SSO 集成 |
| **apps/customer-graph** | 4003 | GPU 关系图可视化 — RBAC Data Scope 演示 |
| **packages/contracts** | — | 共享类型、错误码 (`errors.ts`)、权限码 (`permissions.ts`)、OIDC 常量 (`oidc.ts`) |
| **packages/config** | — | 共享 TypeScript/ESLint 配置 |

## Development Commands

```bash
pnpm dev                    # 启动全部应用
pnpm --filter @auth-sso/idp dev      # 仅 IdP
pnpm --filter @auth-sso/portal dev   # 仅 Portal

# 构建 & 静态检查
pnpm build                  # 全量构建
pnpm lint                   # ESLint
pnpm typecheck              # TypeScript 类型检查

# 数据库 (IdP 子项目)
pnpm db:generate            # Drizzle 生成 migration
pnpm db:migrate             # 执行 migration
pnpm db:push                # 推送 schema 到数据库
pnpm db:seed                # 插入种子数据
pnpm db:studio              # Drizzle Studio GUI

# 基础设施
pnpm infra:up               # docker-compose up -d (PostgreSQL + Redis)

# 测试
cd tests && node smoke.test.js           # 冒烟测试
cd tests && node auth.test.js            # 认证测试
cd tests && node permission.test.js      # 权限测试
cd tests && node data-scope.test.js      # 数据范围测试
cd tests && node sso.test.js             # SSO 流程测试
cd tests && node security.test.js        # 安全测试
cd tests && node runner.js               # 全量测试运行器
```

## Architecture

### 认证流程（OAuth 2.1 Authorization Code + PKCE）

Portal/Demo App 作为 OAuth Client → IdP `/oauth2/authorize` → 用户登录 → 授权码回调 → Client 用授权码换 Token。

关键链路：
- **IdP 认证核心**: `apps/idp/src/lib/auth.ts` — Better Auth 配置，挂载 OIDC Provider + JWT + Bearer 插件，Redis 作为 secondaryStorage
- **Portal 回调入口**: `apps/portal/src/app/api/auth/callback/route.ts` — 用授权码换 Token，创建 Portal Session，智能重定向
- **SSO 登出**: `apps/idp/src/app/api/auth/sign-out-sso/route.ts` — 跨应用联合登出

### Session 架构（双 Session 体系）

系统存在两套独立的 Session 机制，**不可混淆**：

| | IdP Session | Portal Session |
|---|---|---|
| **管理方** | Better Auth 原生 | 自研 Redis Session |
| **存储** | Redis (`auth-sso:` prefix) | Redis (`portal:session:` prefix) |
| **关键文件** | `apps/idp/src/lib/auth.ts` | `apps/portal/src/lib/session.ts` |
| **标识** | `idp_session` cookie | `portal_session_id` cookie |
| **超时** | Better Auth 管理 | idle 30min + absolute 7天 |

Portal Session 支持 Token 自动刷新（`shouldRefreshToken`）、用户级全量踢出（`revokeUserSessions`）。

### RBAC 权限体系

```
用户 ──N:N──> 角色 ──N:N──> 权限 (resource:action 格式，如 user:list)
  │                │
  │                ├── N:N ──> Client (role_clients，控制普通用户可访问的应用)
  │                └── N:N ──> 部门 (role_data_scopes，CUSTOM 数据范围)
  │
  └── Data Scope 类型: ALL | SELF | DEPT | DEPT_AND_SUB | CUSTOM
```

核心模块：
- **权限中间件**: `apps/portal/src/lib/auth-middleware.ts` — `checkPermission()` 验证角色/权限，`withPermission()` 包装 API handler，`checkDataScope()` 执行数据范围过滤
- **权限上下文**: `apps/portal/src/lib/permissions.ts` — `getUserPermissionContext()` 聚合用户角色+权限，Redis 缓存 TTL 300s
- **权限码定义**: `packages/contracts/src/permissions.ts` — 所有 `resource:action` 常量，新增权限必须在此注册

### Data Scope 安全机制

`checkDataScope()` 和 `getDataScopeFilter()` 是 Portal API 路由的数据隔离核心：
- `DEPT_AND_SUB` 使用 `WITH RECURSIVE` CTE 递归查询子部门，深度硬限 10 层防爆
- 异常时 Fail-Safe 降级为严格比对 `context.deptId === targetDeptId`
- 新增 API 路由涉及部门数据时**必须**调用 `checkDataScope()` 或 `getDataScopeFilter()`

### Database Schema

**单一 PostgreSQL 数据库**，Drizzle ORM 管理，Schema 定义在 `apps/idp/src/db/schema/index.ts`（IdP）和 `apps/portal/src/db/schema.ts`（Portal）。

核心表：`users`、`sessions`、`accounts`（Better Auth 兼容表）| `clients`、`authorization_codes`、`oauth_access_tokens`、`oauth_refresh_tokens`（OIDC 表）| `departments`、`roles`、`permissions`、`user_roles`、`role_permissions`、`role_data_scopes`、`role_clients`（RBAC 表）| `menus`、`audit_logs`、`login_logs`（业务表）

所有实体使用 `public_id`（带前缀：`u_`/`d_`/`r_`/`p_`/`m_`/`c_`）对外暴露，内部 `id` 不外泄。

### API 路由约定

Portal API 路由统一使用 `withPermission()` 包装，模式：
```typescript
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['user:list'] }, async (userId) => {
    // 业务逻辑，userId 已鉴权
  });
}
```

### OIDC 授权双重拦截

IdP `/oauth2/authorize` 路由在发放授权码前执行：
1. **实时状态核准** — 查询数据库用户最新状态，非 ACTIVE 直接阻断
2. **动态应用准入** — 非管理员用户必须通过 `role_clients` 绑定才能访问目标 Client

### 审计日志

`apps/portal/src/lib/audit.ts` 提供统一的操作审计记录，所有增删改 API 路由应调用。

## Tech Stack

- Next.js 16 (Turbopack) — 注意：此版本有 breaking changes，编码前阅读 `node_modules/next/dist/docs/`
- Better Auth 1.5+ — OIDC Provider / JWT / Bearer 插件
- Drizzle ORM + PostgreSQL
- Redis (ioredis) — Session 存储、权限缓存、OIDC 状态
- Tailwind CSS 4
- pnpm workspaces，Node.js >= 20，pnpm 10.12.4

## Important Patterns

- **环境变量**: IdP 和 Portal 各有独立的 `.env.local`，通过 `apps/idp/.env.example` 和 `apps/portal/.env.example` 模板配置
- **Redis Key 命名**: IdP 使用 `auth-sso:` / `idp:` 前缀，Portal 使用 `portal:` 前缀
- **权限码格式**: `{资源}:{动作}`（如 `user:list`），新资源必须在 `packages/contracts/src/permissions.ts` 注册
- **Client 配置**: 100% 数据库驱动，代码中不保留业务 Client 配置
- **生产部署**: HTTPS 必须，`BETTER_AUTH_URL` 必须以 `https://` 开头，代理需转发 `X-Forwarded-Proto: https`
- **docs/solutions/**: 记录已解决的问题（bug、最佳实践、设计模式），带 YAML frontmatter，遇到类似问题先查阅

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do not use other tools first.
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
