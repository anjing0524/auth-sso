# Spec: Project Cleanup and Specifications Update (JWT Cookie Migration)

**Date**: 2026-06-12
**Status**: Approved
**Author**: Antigravity

---

## 1. Context & Objectives

The Auth-SSO system was recently migrated from a dual Redis Session architecture to a stateless JWT Cookie architecture for the Portal application. However, multiple project specifications, CLAUDE.md guidance, unit tests, and integration test suites still contain deprecated references to Redis-based sessions (`portal_session_id`). In addition, nested empty directories created by accident currently pollute the workspace.

This project aims to:
1. **Cleanup**: Permanently delete unused empty folders and transient logs.
2. **Update Specifications**: Update all five design specifications under `docs/spec/` and root `CLAUDE.md` to match the current stateless JWT Cookie behavior.
3. **Fix Unit Tests**: Rewrite broken unit tests under `apps/portal/__tests__/` to align with the new JWT module API exports.
4. **Align Integration Tests**: Batch update integration tests under `tests/` to retrieve and assert the correct JWT cookies.

---

## 2. Scope & Implementation Design

### 2.1 Workspace Cleanup
- Remove empty directory structure `apps/portal/apps` recursively.
- Remove transient logs `apps/idp/*.log` (e.g. `idp-dev.log`, `local.log`) to keep the working tree clean.

### 2.2 Specification Files Update
The following documents will be edited via targeted replacements:
- **`CLAUDE.md`**: Update session architecture comparison table and descriptions to replace `portal_session_id` with `portal_jwt_token` and `portal_refresh_token` stored as HttpOnly cookies.
- **`docs/spec/ARCHITECTURE.md`**: Update flowcharts and text descriptions to show stateless verification using JWKS remote key sets. Remove Redis caching references for Portal sessions.
- **`docs/spec/API.md`**: Update authentication details for all admin endpoints. Add specification for the new `POST /api/auth/refresh` silent refresh endpoint.
- **`docs/spec/PRD.md`**: Adjust logout functional requirements and remove outdated Redis session scalability requirements.
- **`docs/spec/TDD-MASTER-PLAN.md`**: Swap assertions verifying `portal_session_id` to `portal_jwt_token`.

### 2.3 Unit Test Suite Alignment
- **`apps/portal/__tests__/api/auth-callback.test.ts`**:
  - Replace `vi.mock('@/lib/session')` to mock `setJwtCookies` instead of `createSession`.
  - Assert that `setJwtCookies` is invoked with correct tokens and lifespan parameters during callback redirects.
- **`apps/portal/__tests__/api/session-lifecycle.test.ts`**:
  - Fully rewrite the file to test the public exports of `apps/portal/src/lib/session.ts` under the stateless JWT Cookie architecture.
  - Add test coverage for `setJwtCookies`, `clearJwtCookies`, `getJwtFromCookie`, `getRefreshTokenFromCookie`, `verifyJwt` (including JTI blocklist verification), `decodeJwtPayload`, and `revokeJti` / `revokeUserToken`.

### 2.4 Integration Test Suite Alignment
Update all test files in the root `tests/` directory to replace the deprecated `portal_session_id` string with `portal_jwt_token` inside cookie headers and assertions:
- `tests/business.test.js`
- `tests/data-scope.test.js`
- `tests/department.test.js`
- `tests/e2e-complete-flow.test.js`
- `tests/session.test.js`
- `tests/sso.test.js`
- `tests/tdd-prd-all.test.js`

---

## 3. Verification Criteria
1. The working tree is clean of nested empty folders and local log files.
2. All documentation accurately reflects the stateless JWT Cookie architecture.
3. Unit tests pass successfully:
   - Run `npx --userconfig=/dev/null vitest run --project @auth-sso/portal` -> 100% PASS.
