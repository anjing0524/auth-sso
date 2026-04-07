---
status: pending
priority: p2
issue_id: "003"
tags: [security, api]
dependencies: ["001"]
---

# Secure User Management API with Data Scope

## Problem Statement

The user management API (`/api/users`) only checks for the `user:read` permission but does not enforce data scope filtering. An administrator might see users from departments outside their authorized scope.

## Findings

- `apps/portal/src/app/api/users/route.ts` needs to be updated to use `getDataScopeFilter` or similar.

## Proposed Solutions

### Option 1: Integrate withDataScopeFilter helper

**Approach:** Use the recommended `withDataScopeFilter` pattern (mentioned in the RBAC plan) to restrict the SQL query results.

**Effort:** 2 hours
**Risk:** Medium (Potential for data leakage if missed)

## Acceptance Criteria

- [ ] `GET /api/users` only returns users within the requester's data scope.
- [ ] `GET /api/users/[id]` returns 403 if target user is outside scope.

## Work Log

### 2026-04-07 - Initial Discovery

**By:** Gemini CLI
- Identified data scope leakage risk in user management.
