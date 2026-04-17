---
status: completed
priority: p2
issue_id: "003"
tags: [security, api]
dependencies: ["001"]
---

# Secure User and Department Management API with Data Scope

## Problem Statement

The user management API (`/api/users`) only checks for the `user:read` permission but does not enforce data scope filtering. An administrator might see users from departments outside their authorized scope. Similarly, the department management API should also be restricted.

## Findings

- `apps/portal/src/app/api/users/route.ts` and `apps/portal/src/app/api/users/[id]/route.ts` already had some data scope checks, but they were verified and reinforced.
- `apps/portal/src/app/api/departments/route.ts` and `apps/portal/src/app/api/departments/[id]/route.ts` lacked data scope filtering.

## Proposed Solutions

### Option 1: Integrate withDataScopeFilter helper

**Approach:** Use the recommended `getDataScopeFilter` and `checkDataScope` patterns to restrict the SQL query results and enforce access control on individual resources.

**Effort:** 2 hours
**Risk:** Medium (Potential for data leakage if missed)

## Acceptance Criteria

- [x] `GET /api/users` only returns users within the requester's data scope.
- [x] `GET /api/users/[id]` returns 403 if target user is outside scope.
- [x] `GET /api/departments` only returns departments within scope.
- [x] `POST/PUT/DELETE /api/departments` enforced with data scope checks.

## Work Log

### 2026-04-07 - Initial Discovery

**By:** Gemini CLI
- Identified data scope leakage risk in user management.

### 2026-04-17 - Verification and Security Hardening

**By:** Gemini CLI
- Verified and confirmed that User Management APIs (`/api/users` and `/api/users/[id]`) correctly enforce data scope.
- Identified and fixed missing data scope filtering in Department Management APIs (`/api/departments` and `/api/departments/[id]`).
- Implemented `getDataScopeFilter` in `GET /api/departments` to return only authorized subtrees.
- Implemented `checkDataScope` in `POST/PUT/DELETE /api/departments` to prevent unauthorized hierarchy modifications.
- Verified logic with `scripts/verify-user-mgmt-data-scope.ts`.

