---
status: completed
priority: p2
issue_id: "002"
tags: [rbac, api]
dependencies: ["001"]
---

# Implement Role Data Scope Management API

## Problem Statement

The system lacks an API to manage custom data scopes for roles. This is required for the `CUSTOM` data scope type to be useful.

## Findings

- `role_data_scopes` table exists in schema but no API endpoints were initially found to manage it.
- Upon investigation, `apps/portal/src/app/api/roles/[id]/data-scopes/route.ts` was already created but had a bug in the `DELETE` method.

## Proposed Solutions

### Option 1: Create CRUD API for role_data_scopes

**Approach:** Implement/Fix GET/POST/DELETE endpoints in `apps/portal/src/app/api/roles/[id]/data-scopes/route.ts`.

**Effort:** 2-3 hours
**Risk:** Low

## Acceptance Criteria

- [x] API can list data scopes for a role.
- [x] API can add/remove departments for a role's custom scope.
- [x] Proper permission checks on these management APIs.

## Work Log

### 2026-04-07 - Initial Discovery

**By:** Gemini CLI
- Identified missing management API for custom data scopes.

### 2026-04-17 - Implementation & Fix

**By:** Gemini CLI
- Verified existing implementation in `apps/portal/src/app/api/roles/[id]/data-scopes/route.ts`.
- Fixed a critical bug in `DELETE` method where it failed to filter by `deptId`, resulting in all associations being deleted.
- Standardized ID generation using `randomUUID()`.
- Verified logic with `scripts/verify-role-data-scope-mgmt.ts`.

