# Requirements Coverage Report

Generated: 2026-06-22T06:54:10.212Z

**Total:** 66/98 covered (**67.3%**)

---

## A: 门户底座 (Portal Infrastructure)

Coverage: **1/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| A-NAV-01 | ✅ | `apps/portal/__tests__/smoke.test.ts` |
| A-NAV-02 | ⚠️ | — |
| A-NAV-03 | ⚠️ | — |

## B: 用户管理 (User Management)

Coverage: **8/9**

| Requirement | Status | Test Files |
| --- | --- | --- |
| B-USR-L | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-S | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-C | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-R | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts` |
| B-USR-U | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-D | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-ST | ⚠️ | — |
| B-LOG-L | ✅ | `apps/portal/__tests__/api/audit-logging.test.ts` |
| B-LOG-D | ✅ | `apps/portal/__tests__/api/audit-logging.test.ts` |

## C: 角色与授权 (Role & Authorization)

Coverage: **18/18**

| Requirement | Status | Test Files |
| --- | --- | --- |
| C-ROL-L | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-C | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-U | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-D | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-PA | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-CA | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-DS | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| D-ROLE-C | ✅ | `apps/portal/__tests__/domain/role.test.ts` |
| D-ROLE-U | ✅ | `apps/portal/__tests__/domain/role.test.ts` |
| D-ROLE-D | ✅ | `apps/portal/__tests__/domain/role.test.ts` |
| SCOPE-001 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| SCOPE-002 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| SCOPE-003 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| SCOPE-004 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| SCOPE-005 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| RBAC-ADMIN-FULL-ACCESS | ✅ | `tests/e2e/rbac-enforcement.spec.ts` |
| RBAC-RESTRICTED-API | ✅ | `tests/e2e/rbac-enforcement.spec.ts` |
| RBAC-UNAUTHORIZED | ✅ | `tests/e2e/rbac-enforcement.spec.ts` |

## D: 权限标识维护 (Permission Registry)

Coverage: **4/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| D-PRM-L | ✅ | `apps/portal/__tests__/api/permission-api.test.ts`<br>`tests/e2e/permission-management.spec.ts` |
| D-PRM-C | ✅ | `apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts`<br>`tests/e2e/permission-management.spec.ts` |
| D-PRM-U | ✅ | `apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts` |
| D-PRM-D | ✅ | `apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts` |

## E: 菜单架构管理 (Menu Management)

Coverage: **8/8**

| Requirement | Status | Test Files |
| --- | --- | --- |
| E-MNU-L | ✅ | `apps/portal/__tests__/api/menu-api.test.ts`<br>`tests/e2e/menu-management.spec.ts` |
| E-MNU-C | ✅ | `apps/portal/__tests__/api/menu-api.test.ts`<br>`tests/e2e/menu-management.spec.ts` |
| E-MNU-U | ✅ | `apps/portal/__tests__/api/menu-api.test.ts` |
| E-MNU-D | ✅ | `apps/portal/__tests__/api/menu-api.test.ts` |
| E-MNU-PB | ✅ | `apps/portal/__tests__/api/menu-api.test.ts` |
| D-MEN-C | ✅ | `apps/portal/__tests__/domain/menu.test.ts` |
| D-MEN-U | ✅ | `apps/portal/__tests__/domain/menu.test.ts` |
| D-MEN-D | ✅ | `apps/portal/__tests__/domain/menu.test.ts` |

## F: 组织架构 (Department Management)

Coverage: **8/9**

| Requirement | Status | Test Files |
| --- | --- | --- |
| F-DEP-L | ✅ | `apps/portal/__tests__/api/department-api.test.ts`<br>`tests/e2e/department-management.spec.ts` |
| F-DEP-C | ✅ | `apps/portal/__tests__/api/department-api.test.ts`<br>`tests/e2e/department-management.spec.ts` |
| F-DEP-U | ✅ | `apps/portal/__tests__/api/department-api.test.ts`<br>`tests/e2e/department-management.spec.ts` |
| F-DEP-D | ✅ | `apps/portal/__tests__/api/department-api.test.ts`<br>`tests/e2e/department-management.spec.ts` |
| F-DEP-E | ⚠️ | — |
| F-DEP-M | ✅ | `apps/portal/__tests__/api/department-api.test.ts` |
| D-DEPT-C | ✅ | `apps/portal/__tests__/domain/department.test.ts` |
| D-DEPT-U | ✅ | `apps/portal/__tests__/domain/department.test.ts` |
| D-DEPT-D | ✅ | `apps/portal/__tests__/domain/department.test.ts` |

## G: 应用与安全 (OAuth & Security)

Coverage: **12/12**

| Requirement | Status | Test Files |
| --- | --- | --- |
| G-CLT-L | ✅ | `apps/portal/__tests__/api/client-api.test.ts`<br>`tests/e2e/client-management.spec.ts` |
| G-CLT-C | ✅ | `apps/portal/__tests__/api/client-api.test.ts`<br>`tests/e2e/client-management.spec.ts` |
| G-CLT-U | ✅ | `apps/portal/__tests__/api/client-api.test.ts`<br>`tests/e2e/client-management.spec.ts` |
| G-CLT-D | ✅ | `apps/portal/__tests__/api/client-api.test.ts` |
| D-CLI-C | ✅ | `apps/portal/__tests__/domain/client.test.ts` |
| D-CLI-U | ✅ | `apps/portal/__tests__/domain/client.test.ts` |
| D-CLI-D | ✅ | `apps/portal/__tests__/domain/client.test.ts` |
| G-SEC-INT | ✅ | `tests/e2e/auth-flow.spec.ts`<br>`tests/e2e/rbac-enforcement.spec.ts`<br>`tests/e2e/sso-cross-app.spec.ts` |
| AUTH-003 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts` |
| AUTH-004 | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts` |
| AUTH-005 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts` |
| AUTH-006 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts` |

## H: OAuth 2.1 认证流程

Coverage: **4/14**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-AUTH-001 | ⚠️ | — |
| H-AUTH-002 | ⚠️ | — |
| H-AUTH-003 | ⚠️ | — |
| H-AUTH-004 | ⚠️ | — |
| H-AUTH-005 | ⚠️ | — |
| H-AUTH-010 | ⚠️ | — |
| H-AUTH-011 | ⚠️ | — |
| H-AUTH-012 | ⚠️ | — |
| H-AUTH-013 | ⚠️ | — |
| H-AUTH-014 | ⚠️ | — |
| AUTH-FLOW-HAPPY | ✅ | `tests/e2e/auth-flow.spec.ts` |
| AUTH-FLOW-LOGOUT | ✅ | `tests/e2e/auth-flow.spec.ts` |
| AUTH-FLOW-WRONG-PASSWORD | ✅ | `tests/e2e/auth-flow.spec.ts` |
| AUTH-FLOW-PROTECTED-REDIRECT | ✅ | `tests/e2e/auth-flow.spec.ts` |

## H: Portal JWT Cookie 生命周期

Coverage: **0/10**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-SESS-001 | ⚠️ | — |
| H-SESS-002 | ⚠️ | — |
| H-SESS-003 | ⚠️ | — |
| H-SESS-010 | ⚠️ | — |
| H-SESS-011 | ⚠️ | — |
| H-SESS-012 | ⚠️ | — |
| H-SESS-020 | ⚠️ | — |
| H-SESS-021 | ⚠️ | — |
| H-SESS-022 | ⚠️ | — |
| H-SESS-030 | ⚠️ | — |

## H: 单点登录/登出

Coverage: **3/11**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-SSO-001 | ⚠️ | — |
| H-SSO-002 | ⚠️ | — |
| H-SSO-003 | ⚠️ | — |
| H-SSO-010 | ⚠️ | — |
| H-SSO-011 | ⚠️ | — |
| H-SSO-020 | ⚠️ | — |
| H-SSO-021 | ⚠️ | — |
| H-SSO-022 | ⚠️ | — |
| SSO-CROSS-APP | ✅ | `tests/e2e/sso-cross-app.spec.ts` |
| SSO-DIRECT-ACCESS | ✅ | `tests/e2e/sso-cross-app.spec.ts` |
| SSO-LOGOUT-PROPAGATION | ✅ | `tests/e2e/sso-cross-app.spec.ts` |
