# Requirements Coverage Report

Generated: 2026-06-25T08:17:35.598Z

**Requirements:** 66/70 covered (**94.3%**)
**Architecture Constraints:** 17/20 covered

---

## A: 门户底座 (Portal Infrastructure)

Coverage: **1/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| A-NAV-01 | ✅ | `apps/portal/__tests__/smoke.test.ts` |
| A-NAV-02 | ⚠️ | — |
| A-NAV-03 | ⚠️ | — |

## B: 用户管理 (User Management)

Coverage: **8/8**

| Requirement | Status | Test Files |
| --- | --- | --- |
| B-USR-L | ✅ | `apps/portal/__tests__/api/user-api.test.ts`<br>`tests/e2e/user-management.spec.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| B-USR-S | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-C | ✅ | `apps/portal/__tests__/api/user-api.test.ts`<br>`tests/e2e/user-management.spec.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| B-USR-R | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts`<br>`apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-U | ✅ | `apps/portal/__tests__/api/user-api.test.ts`<br>`tests/e2e/user-management.spec.ts` |
| B-USR-D | ✅ | `apps/portal/__tests__/api/user-api.test.ts`<br>`tests/e2e/user-management.spec.ts` |
| B-USR-ST | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-PW | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |

## C: 角色与授权 (Role & Authorization)

Coverage: **6/6**

| Requirement | Status | Test Files |
| --- | --- | --- |
| C-ROL-L | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-C | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-U | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-D | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-PA | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-ASGN | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |

## D: 权限管理 (Permission Management)

Coverage: **4/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| D-PRM-L | ✅ | `apps/portal/__tests__/api/permission-api.test.ts`<br>`tests/e2e/permission-management.spec.ts` |
| D-PRM-C | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts`<br>`apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts`<br>`tests/e2e/permission-management.spec.ts` |
| D-PRM-U | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts`<br>`apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts` |
| D-PRM-D | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts`<br>`apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts` |

## E: 菜单管理 (Menu Management)

Coverage: **5/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| E-MNU-L | ✅ | `tests/e2e/menu-management.spec.ts` |
| E-MNU-C | ✅ | `tests/e2e/menu-management.spec.ts` |
| E-MNU-U | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |
| E-MNU-D | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |
| E-MNU-PB | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |

## F: 组织架构 (Department Management)

Coverage: **5/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| F-DEP-L | ✅ | `apps/portal/__tests__/api/department-api.test.ts`<br>`tests/e2e/department-management.spec.ts` |
| F-DEP-C | ✅ | `apps/portal/__tests__/api/department-api.test.ts`<br>`tests/e2e/department-management.spec.ts` |
| F-DEP-U | ✅ | `apps/portal/__tests__/api/department-api.test.ts`<br>`tests/e2e/department-management.spec.ts` |
| F-DEP-D | ✅ | `apps/portal/__tests__/api/department-api.test.ts`<br>`tests/e2e/department-management.spec.ts` |
| F-DEP-M | ✅ | `apps/portal/__tests__/api/department-api.test.ts` |

## G: 应用集成 (Application Integration)

Coverage: **5/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| G-CLT-L | ✅ | `apps/portal/__tests__/api/client-api.test.ts`<br>`tests/e2e/client-management.spec.ts` |
| G-CLT-C | ✅ | `apps/portal/__tests__/api/client-actions.test.ts`<br>`apps/portal/__tests__/api/client-api.test.ts`<br>`tests/e2e/client-management.spec.ts` |
| G-CLT-U | ✅ | `apps/portal/__tests__/api/client-actions.test.ts`<br>`apps/portal/__tests__/api/client-api.test.ts`<br>`tests/e2e/client-management.spec.ts` |
| G-CLT-D | ✅ | `apps/portal/__tests__/api/client-actions.test.ts`<br>`apps/portal/__tests__/api/client-api.test.ts` |
| G-CLT-SEC | ✅ | `apps/portal/__tests__/api/client-actions.test.ts` |

## H: 会话管理

Coverage: **6/6**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-SESS-001 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts` |
| H-SESS-002 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts` |
| H-SESS-003 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts` |
| H-SESS-004 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts` |
| H-SESS-005 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts` |
| H-SESS-006 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts` |

## H: 单点登录与登出

Coverage: **4/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-SSO-001 | ✅ | `tests/e2e/auth-flow.spec.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| H-SSO-002 | ✅ | `tests/e2e/auth-flow.spec.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| H-SSO-003 | ✅ | `apps/portal/__tests__/api/auth-logout.test.ts` |
| H-SSO-004 | ✅ | `apps/portal/__tests__/api/auth-logout.test.ts`<br>`apps/portal/__tests__/api/session-lifecycle.test.ts` |

## H: 数据范围控制

Coverage: **3/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-DSCOPE-001 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| H-DSCOPE-002 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| H-DSCOPE-003 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |

## H: 用户认证

Coverage: **10/10**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-AUTH-001 | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| H-AUTH-002 | ✅ | `apps/portal/__tests__/api/auth-login.test.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| H-AUTH-003 | ✅ | `apps/portal/__tests__/domain/auth.test.ts` |
| H-AUTH-004 | ✅ | `apps/portal/__tests__/domain/auth.test.ts` |
| H-AUTH-005 | ✅ | `tests/e2e/user-story-screenshots.spec.ts` |
| H-AUTH-006 | ✅ | `apps/portal/__tests__/api/auth-login.test.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| H-AUTH-010 | ✅ | `apps/portal/__tests__/domain/auth.test.ts` |
| H-AUTH-011 | ✅ | `apps/portal/__tests__/domain/auth.test.ts` |
| H-AUTH-012 | ✅ | `tests/e2e/auth-flow.spec.ts` |
| H-AUTH-013 | ✅ | `tests/e2e/auth-flow.spec.ts` |

## H: 端到端流程验证

Coverage: **4/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-FLOW-001 | ✅ | `tests/e2e/auth-flow.spec.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| H-FLOW-002 | ✅ | `tests/e2e/auth-flow.spec.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| H-FLOW-003 | ✅ | `tests/e2e/auth-flow.spec.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |
| H-FLOW-004 | ✅ | `tests/e2e/auth-flow.spec.ts`<br>`tests/e2e/user-story-screenshots.spec.ts` |

## H: 访问控制

Coverage: **3/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-ACL-001 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts`<br>`tests/e2e/rbac-enforcement.spec.ts` |
| H-ACL-002 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts`<br>`tests/e2e/rbac-enforcement.spec.ts` |
| H-ACL-003 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts`<br>`tests/e2e/rbac-enforcement.spec.ts` |

## I: 审计与日志 (Audit & Logging)

Coverage: **2/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| I-LOG-001 | ✅ | `apps/portal/__tests__/api/audit-logging.test.ts` |
| I-LOG-002 | ✅ | `apps/portal/__tests__/api/audit-logging.test.ts` |
| I-LOG-003 | ⚠️ | — |
| I-LOG-004 | ⚠️ | — |
