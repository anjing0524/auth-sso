---
status: pending
priority: p2
issue_id: "002"
tags: [rbac, api]
dependencies: ["001"]
---

# Implement Role Data Scope Management API

## Problem Statement

The system lacks an API to manage custom data scopes for roles. This is required for the `CUSTOM` data scope type to be useful.

## Findings

- `role_data_scopes` table exists in schema but no API endpoints are found to manage it.
- Requirement R3 in RBAC plan: "Provide management API for role custom data scopes".

## Proposed Solutions

### Option 1: Create CRUD API for role_data_scopes

**Approach:** Implement GET/POST/DELETE endpoints in `apps/portal/src/app/api/roles/[id]/data-scopes/route.ts`.

**Effort:** 2-3 hours
**Risk:** Low

## Acceptance Criteria

- [ ] API can list data scopes for a role.
- [ ] API can add/remove departments for a role's custom scope.
- [ ] Proper permission checks on these management APIs.

## Work Log

### 2026-04-07 - Initial Discovery

**By:** Gemini CLI
- Identified missing management API for custom data scopes.
