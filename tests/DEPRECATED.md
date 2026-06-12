# 旧测试文件废弃通知 / Old Test Files Deprecation Notice

> **保留周期**: 本目录下的旧测试文件保留一个发布周期（下一个 minor 版本后移除）。
> 在此期间可参考旧测试逻辑补全新 Vitest/Playwright 测试的边界场景，但**不要**直接修改或运行旧文件。

## 迁移映射 / Migration Mapping

| 旧文件 (Old) | 新测试文件 (New) | 说明 |
| :--- | :--- | :--- |
| `auth.test.js` | `apps/portal/__tests__/api/auth-callback.test.ts`<br>`apps/idp/__tests__/api/oauth-authorize.test.ts` | OAuth 授权码流程 |
| `auth-security.test.js` | `apps/portal/__tests__/api/sso-security.test.ts` | PKCE / State / Nonce 安全校验 |
| `permission.test.js` | `apps/portal/__tests__/api/permission-api.test.ts` | 权限标识 CRUD API |
| `security.test.js` | `apps/portal/__tests__/api/permission-enforcement.test.ts` | RBAC 权限强制验证 |
| `data-scope.test.js` | `apps/portal/__tests__/api/data-scope.test.ts` | 数据范围过滤（ALL/SELF/DEPT/CUSTOM） |
| `data-scope-self.test.js` | `apps/portal/__tests__/api/data-scope.test.ts` | 数据范围——自身数据 |
| `department.test.js` | `apps/portal/__tests__/api/department-api.test.ts` | 部门管理 CRUD |
| `session.test.js` | `apps/portal/__tests__/api/session-lifecycle.test.ts` | Session 生命周期、TTL、Token 刷新 |
| `sso.test.js` | `tests/e2e/auth-flow.spec.ts`<br>`tests/e2e/sso-cross-app.spec.ts` | 跨应用 SSO 登录/登出（Playwright） |
| `rbac-business.test.js` | `apps/portal/__tests__/api/role-api.test.ts` | 角色+权限+数据范围绑定 |
| `business.test.js` | `apps/portal/__tests__/api/*.test.ts` | 分散到各 API 测试 |
| `smoke.test.js` | `apps/portal/__tests__/smoke.test.ts`<br>`apps/idp/__tests__/smoke.test.ts` | 冒烟/基础设施测试 |
| `detailed-logic.test.js` | `apps/portal/__tests__/api/*.test.ts` | 分散到各 API 测试 |
| `performance.test.js` | 无直接替代 | 负载/性能测试暂未覆盖 |
| `e2e-complete-flow.test.js` | `tests/e2e/auth-flow.spec.ts` | 全链路 E2E（Playwright） |
| `ui-bridge-verify.js` | `tests/e2e/*.spec.ts` | 前端交互验证（Playwright） |

## 基础设施脚本 / Infrastructure Scripts

以下工具脚本在旧框架中用于辅助测试，新框架无需使用：

| 文件 | 替代方案 |
| :--- | :--- |
| `config.js` | Vitest 配置文件、Playwright `playwright.config.ts` |
| `runner.js` | `vitest run` + `playwright test` |
| `utils.js` | Vitest `vi.mock()`、Playwright test fixtures |
| `check-db.js` / `test-db-conn.js` | `pnpm db:push` / `pnpm db:migrate` |
| `check-readiness.js` | Playwright webServer health check |
| `debug-auth.js` | 手工调试使用 `pnpm --filter @auth-sso/idp dev` |
| `start-services.sh` | `pnpm infra:up`（Docker Compose） |

## 迁移检查清单 / Migration Checklist

- [ ] 所有 Vitest API 测试通过: `pnpm test:api`
- [ ] 所有 Playwright E2E 测试通过: `pnpm test:e2e`
- [ ] 需求覆盖率报告通过阈值: `pnpm test:report --threshold 90`
- [ ] 旧 `tests/` 目录中的所有功能点在新测试中有覆盖
- [ ] 旧测试文件可安全删除（下一个发布周期）

---

*最后更新: 2026-06-11*
