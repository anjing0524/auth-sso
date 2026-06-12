# Requirements Coverage Report

Generated: 2026-06-11T09:44:07.134Z

**Total:** 35/62 covered (**56.5%**)

---

## A: 门户底座 (Portal Infrastructure)

Coverage: **1/3**

| Requirement | Status | Test Files |
| --- | --- | --- |
| A-NAV-01 | ✅ | `apps/portal/__tests__/smoke.test.ts` |
| A-NAV-02 | ⚠️ | — |
| A-NAV-03 | ⚠️ | — |

## B: 用户管理 (User Management)

Coverage: **7/7**

| Requirement | Status | Test Files |
| --- | --- | --- |
| B-USR-L | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-S | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-C | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-R | ✅ | `apps/portal/__tests__/api/me-endpoints.test.ts`<br>`apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-U | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-D | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |
| B-USR-ST | ✅ | `apps/portal/__tests__/api/user-api.test.ts` |

## C: 角色与授权 (Role & Authorization)

Coverage: **7/7**

| Requirement | Status | Test Files |
| --- | --- | --- |
| C-ROL-L | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-C | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-U | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-D | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-PA | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-CA | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |
| C-ROL-DS | ✅ | `apps/portal/__tests__/api/role-api.test.ts` |

## D: 权限标识维护 (Permission Registry)

Coverage: **4/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| D-PRM-L | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |
| D-PRM-C | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |
| D-PRM-U | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |
| D-PRM-D | ✅ | `apps/portal/__tests__/api/permission-api.test.ts` |

## E: 菜单架构管理 (Menu Management)

Coverage: **5/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| E-MNU-L | ✅ | `apps/portal/__tests__/api/menu-api.test.ts` |
| E-MNU-C | ✅ | `apps/portal/__tests__/api/menu-api.test.ts` |
| E-MNU-U | ✅ | `apps/portal/__tests__/api/menu-api.test.ts` |
| E-MNU-D | ✅ | `apps/portal/__tests__/api/menu-api.test.ts` |
| E-MNU-PB | ✅ | `apps/portal/__tests__/api/menu-api.test.ts` |

## F: 组织架构 (Department Management)

Coverage: **4/4**

| Requirement | Status | Test Files |
| --- | --- | --- |
| F-DEP-L | ✅ | `apps/portal/__tests__/api/department-api.test.ts` |
| F-DEP-C | ✅ | `apps/portal/__tests__/api/department-api.test.ts` |
| F-DEP-U | ✅ | `apps/portal/__tests__/api/department-api.test.ts` |
| F-DEP-D | ✅ | `apps/portal/__tests__/api/department-api.test.ts` |

## G: 应用与安全 (OAuth & Security)

Coverage: **5/5**

| Requirement | Status | Test Files |
| --- | --- | --- |
| G-CLT-L | ✅ | `apps/portal/__tests__/api/client-api.test.ts` |
| G-CLT-C | ✅ | `apps/portal/__tests__/api/client-api.test.ts` |
| G-CLT-U | ✅ | `apps/portal/__tests__/api/client-api.test.ts` |
| G-CLT-D | ✅ | `apps/portal/__tests__/api/client-api.test.ts` |
| G-SEC-INT | ✅ | `apps/idp/__tests__/api/oauth-authorize.test.ts`<br>`apps/idp/__tests__/api/sign-out-sso.test.ts`<br>`apps/portal/__tests__/api/sso-security.test.ts`<br>`tests/e2e/auth-flow.spec.ts`<br>`tests/e2e/rbac-enforcement.spec.ts`<br>`tests/e2e/sso-cross-app.spec.ts` |

## H: OAuth 2.1 认证流程

Coverage: **2/10**

| Requirement | Status | Test Files |
| --- | --- | --- |
| H-AUTH-001 | ✅ | `apps/idp/__tests__/api/oauth-authorize.test.ts` |
| H-AUTH-002 | ✅ | `apps/idp/__tests__/api/oauth-authorize.test.ts` |
| H-AUTH-003 | ⚠️ | — |
| H-AUTH-004 | ⚠️ | — |
| H-AUTH-005 | ⚠️ | — |
| H-AUTH-010 | ⚠️ | — |
| H-AUTH-011 | ⚠️ | — |
| H-AUTH-012 | ⚠️ | — |
| H-AUTH-013 | ⚠️ | — |
| H-AUTH-014 | ⚠️ | — |

## H: Portal Session 生命周期

Coverage: **0/9**

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

## H: 单点登录/登出

Coverage: **0/8**

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

## Unrecognized @req IDs

These IDs appear in `@req` annotations but are not found in the requirements matrix:

- `AUTH-001`
- `AUTH-002`
- `AUTH-003`
- `AUTH-004`
- `AUTH-005`
- `B-LOG-D`
- `B-LOG-L`
- `F-DEP-E`
- `F-DEP-M`
- `SCOPE-001`
- `SCOPE-002`
- `SCOPE-003`
- `SCOPE-004`
- `SCOPE-005`
- `SESS-001`
- `SESS-002`
- `SESS-003`
- `SESS-004`
- `SESS-005`
