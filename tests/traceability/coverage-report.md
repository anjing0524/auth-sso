# Requirements Coverage Report

Generated: 2026-06-24T07:38:59.249Z

**Total:** 41/90 covered (**45.6%**)

---

## A: 门户底座 (Portal Infrastructure)

Coverage: **1/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| A-NAV-01 | ✅ | `apps/portal/__tests__/smoke.test.ts` |
| A-NAV-02 | ⚠️ | — |
| A-NAV-03 | ⚠️ | — |

## B: 用户管理 (User Management)

Coverage: **6/8**

| Requirement | Status | Test Files |
| --- | --- | --- |
| B-USR-L | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-S | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-C | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-R | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts` |
| B-USR-U | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-D | ✅ | `tests/e2e/user-management.spec.ts` |
| B-USR-ST | ⚠️ | — |
| B-USR-PW | ⚠️ | — |

## C: 角色与授权 (Role & Authorization)

Coverage: **5/6**

| Requirement | Status | Test Files |
| --- | --- | --- |
| C-ROL-L | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-C | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-U | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-D | ✅ | `apps/portal/__tests__/api/role-api.test.ts`<br>`tests/e2e/role-management.spec.ts` |
| C-ROL-PA | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-ASGN | ⚠️ | — |

## D: 权限管理 (Permission Management)

Coverage: **4/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| D-PRM-L | ✅ | `apps/portal/__tests__/api/permission-api.test.ts`<br>`tests/e2e/permission-management.spec.ts` |
| D-PRM-C | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts`<br>`apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts`<br>`tests/e2e/permission-management.spec.ts` |
| D-PRM-U | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts`<br>`apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts` |
| D-PRM-D | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts`<br>`apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts` |

## E: 菜单管理 (Menu Management)

Coverage: **2/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| E-MNU-L | ✅ | `tests/e2e/menu-management.spec.ts` |
| E-MNU-C | ✅ | `tests/e2e/menu-management.spec.ts` |
| E-MNU-U | ⚠️ | — |
| E-MNU-D | ⚠️ | — |
| E-MNU-PB | ⚠️ | — |

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

Coverage: **4/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| G-CLT-L | ✅ | `apps/portal/__tests__/api/client-api.test.ts`<br>`tests/e2e/client-management.spec.ts` |
| G-CLT-C | ✅ | `apps/portal/__tests__/api/client-actions.test.ts`<br>`apps/portal/__tests__/api/client-api.test.ts`<br>`tests/e2e/client-management.spec.ts` |
| G-CLT-U | ✅ | `apps/portal/__tests__/api/client-actions.test.ts`<br>`apps/portal/__tests__/api/client-api.test.ts`<br>`tests/e2e/client-management.spec.ts` |
| G-CLT-D | ✅ | `apps/portal/__tests__/api/client-actions.test.ts`<br>`apps/portal/__tests__/api/client-api.test.ts` |
| G-CLT-SEC | ⚠️ | — |

## H: 会话管理

Coverage: **0/6**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-SESS-001 | ⚠️ | — |
| H-SESS-002 | ⚠️ | — |
| H-SESS-003 | ⚠️ | — |
| H-SESS-004 | ⚠️ | — |
| H-SESS-005 | ⚠️ | — |
| H-SESS-006 | ⚠️ | — |

## H: 单点登录与登出

Coverage: **1/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-SSO-001 | ⚠️ | — |
| H-SSO-002 | ⚠️ | — |
| H-SSO-003 | ⚠️ | — |
| H-SSO-004 | ✅ | `apps/portal/__tests__/api/auth-logout.test.ts` |

## H: 数据范围控制

Coverage: **3/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-DSCOPE-001 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| H-DSCOPE-002 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts` |
| H-DSCOPE-003 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts` |

## H: 用户认证

Coverage: **1/10**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-AUTH-001 | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts` |
| H-AUTH-002 | ⚠️ | — |
| H-AUTH-003 | ⚠️ | — |
| H-AUTH-004 | ⚠️ | — |
| H-AUTH-005 | ⚠️ | — |
| H-AUTH-006 | ⚠️ | — |
| H-AUTH-010 | ⚠️ | — |
| H-AUTH-011 | ⚠️ | — |
| H-AUTH-012 | ⚠️ | — |
| H-AUTH-013 | ⚠️ | — |

## H: 端到端流程验证

Coverage: **4/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-FLOW-001 | ✅ | `tests/e2e/auth-flow.spec.ts` |
| H-FLOW-002 | ✅ | `tests/e2e/auth-flow.spec.ts` |
| H-FLOW-003 | ✅ | `tests/e2e/auth-flow.spec.ts` |
| H-FLOW-004 | ✅ | `tests/e2e/auth-flow.spec.ts` |

## H: 访问控制

Coverage: **3/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-ACL-001 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts`<br>`tests/e2e/rbac-enforcement.spec.ts` |
| H-ACL-002 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts`<br>`tests/e2e/rbac-enforcement.spec.ts` |
| H-ACL-003 | ✅ | `tests/e2e/rbac-enforcement.spec.ts` |

## I: 审计与日志 (Audit & Logging)

Coverage: **2/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| I-LOG-001 | ✅ | `apps/portal/__tests__/api/audit-logging.test.ts` |
| I-LOG-002 | ✅ | `apps/portal/__tests__/api/audit-logging.test.ts` |
| I-LOG-003 | ⚠️ | — |
| I-LOG-004 | ⚠️ | — |

## Unrecognized @req IDs

These IDs appear in `@req` annotations but are not found in the requirements matrix:

- `C-ROL-CA`
- `C-ROL-DS`
- `H-ACL-004`
- `H-ACL-005`
- `H-DSCOPE-004`
- `H-DSCOPE-005`
