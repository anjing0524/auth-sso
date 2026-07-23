# Requirements Coverage Report

Generated: 2026-07-23T06:14:53.846Z

**Requirements:** 48/76 covered (**63.2%**)
**Architecture Constraints:** 17/27 covered

---

## A: 门户底座 (Portal Infrastructure)

Coverage: **1/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| A-NAV-01 | ✅ | `apps/portal/__tests__/components/app-sidebar.test.tsx`<br>`apps/portal/__tests__/smoke.test.ts` |
| A-NAV-02 | ⚠️ | — |
| A-NAV-03 | ⚠️ | — |

## B: 用户管理 (User Management)

Coverage: **7/8**

| Requirement | Status | Test Files |
| --- | --- | --- |
| B-USR-L | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-S | ⚠️ | — |
| B-USR-C | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-R | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts`<br>`apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-U | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-D | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-ST | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-PW | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |

## C: 角色与授权 (Role & Authorization)

Coverage: **3/6**

| Requirement | Status | Test Files |
| --- | --- | --- |
| C-ROL-L | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-C | ⚠️ | — |
| C-ROL-U | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-D | ⚠️ | — |
| C-ROL-PA | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-ASGN | ⚠️ | — |

## D: 权限管理 (Permission Management)

Coverage: **4/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| D-PRM-L | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |
| D-PRM-C | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts`<br>`apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts` |
| D-PRM-U | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts`<br>`apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/components/empty-state.test.tsx`<br>`apps/portal/__tests__/domain/permission.test.ts` |
| D-PRM-D | ✅ | `apps/portal/__tests__/api/permission-actions.test.ts`<br>`apps/portal/__tests__/api/permission-api.test.ts`<br>`apps/portal/__tests__/domain/permission.test.ts` |

## E: 菜单管理 (Menu Management)

Coverage: **3/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| E-MNU-L | ⚠️ | — |
| E-MNU-C | ⚠️ | — |
| E-MNU-U | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |
| E-MNU-D | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |
| E-MNU-PB | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |

## F: 组织架构 (Department Management)

Coverage: **3/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| F-DEP-L | ✅ | `apps/portal/__tests__/api/department-api.test.ts` |
| F-DEP-C | ✅ | `apps/portal/__tests__/api/department-api.test.ts` |
| F-DEP-U | ✅ | `apps/portal/__tests__/api/department-api.test.ts` |
| F-DEP-D | ⚠️ | — |
| F-DEP-M | ⚠️ | — |

## G: 应用集成 (Application Integration)

Coverage: **5/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| G-CLT-L | ✅ | `apps/portal/__tests__/api/client-api.test.ts` |
| G-CLT-C | ✅ | `apps/portal/__tests__/api/client-actions.test.ts`<br>`apps/portal/__tests__/api/client-api.test.ts` |
| G-CLT-U | ✅ | `apps/portal/__tests__/api/client-actions.test.ts`<br>`apps/portal/__tests__/api/client-api.test.ts` |
| G-CLT-D | ✅ | `apps/portal/__tests__/api/client-actions.test.ts`<br>`apps/portal/__tests__/api/client-api.test.ts` |
| G-CLT-SEC | ✅ | `apps/portal/__tests__/api/client-actions.test.ts` |

## H: 会话管理

Coverage: **6/6**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-SESS-001 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts`<br>`tests/integration/m3-verification.test.ts` |
| H-SESS-002 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts`<br>`tests/integration/m3-verification.test.ts` |
| H-SESS-003 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts`<br>`tests/integration/m3-verification.test.ts` |
| H-SESS-004 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts`<br>`tests/integration/m3-verification.test.ts` |
| H-SESS-005 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts`<br>`tests/integration/m3-verification.test.ts` |
| H-SESS-006 | ✅ | `apps/portal/__tests__/api/session-lifecycle.test.ts`<br>`tests/integration/m3-verification.test.ts` |

## H: 单点登录与登出

Coverage: **3/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-SSO-001 | ✅ | `tests/integration/oauth-flow.test.ts` |
| H-SSO-002 | ⚠️ | — |
| H-SSO-003 | ✅ | `apps/portal/__tests__/api/auth-logout.test.ts`<br>`tests/integration/m3-verification.test.ts` |
| H-SSO-004 | ✅ | `apps/portal/__tests__/api/auth-logout.test.ts`<br>`apps/portal/__tests__/api/session-lifecycle.test.ts` |

## H: 数据范围控制

Coverage: **3/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-DSCOPE-001 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| H-DSCOPE-002 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |
| H-DSCOPE-003 | ✅ | `apps/portal/__tests__/api/data-scope.test.ts`<br>`apps/portal/__tests__/api/department-api.test.ts` |

## H: 用户认证

Coverage: **7/10**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-AUTH-001 | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts` |
| H-AUTH-002 | ✅ | `apps/portal/__tests__/api/auth-login.test.ts` |
| H-AUTH-003 | ✅ | `apps/portal/__tests__/domain/auth.test.ts`<br>`tests/integration/oauth-flow.test.ts` |
| H-AUTH-004 | ✅ | `apps/portal/__tests__/domain/auth.test.ts`<br>`tests/integration/oauth-flow.test.ts` |
| H-AUTH-005 | ⚠️ | — |
| H-AUTH-006 | ✅ | `apps/portal/__tests__/api/auth-login.test.ts` |
| H-AUTH-010 | ✅ | `apps/portal/__tests__/domain/auth.test.ts` |
| H-AUTH-011 | ✅ | `apps/portal/__tests__/domain/auth.test.ts` |
| H-AUTH-012 | ⚠️ | — |
| H-AUTH-013 | ⚠️ | — |

## H: 端到端流程验证

Coverage: **0/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-FLOW-001 | ⚠️ | — |
| H-FLOW-002 | ⚠️ | — |
| H-FLOW-003 | ⚠️ | — |
| H-FLOW-004 | ⚠️ | — |

## H: 访问控制

Coverage: **3/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-ACL-001 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts`<br>`apps/portal/__tests__/components/permission-guard.test.tsx` |
| H-ACL-002 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts`<br>`apps/portal/__tests__/api/user-role-api.test.ts` |
| H-ACL-003 | ✅ | `apps/portal/__tests__/api/permission-enforcement.test.ts` |

## J: 审计与日志 (Audit & Logging)

Coverage: **0/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| J-LOG-001 | ⚠️ | — |
| J-LOG-002 | ⚠️ | — |
| J-LOG-003 | ⚠️ | — |
| J-LOG-004 | ⚠️ | — |

## K: Portal 设计打磨 (Design Polish)

Coverage: **0/6**

| Requirement | Status | Test Files |
| --- | --- | --- |
| D-POLISH-001 | ⚠️ | — |
| D-POLISH-002 | ⚠️ | — |
| D-POLISH-003 | ⚠️ | — |
| D-POLISH-004 | ⚠️ | — |
| D-POLISH-005 | ⚠️ | — |
| D-POLISH-006 | ⚠️ | — |

## Unrecognized @req IDs

These IDs appear in `@req` annotations but are not found in the requirements matrix:

- `NFR-PERF-03`
- `NFR-SEC-06`
- `R-USER-ROLE`
