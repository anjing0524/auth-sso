---
status: completed
priority: p1
issue_id: "001"
tags: [rbac, security]
dependencies: []
---

# Verify RBAC Data Scope Logic in auth-middleware.ts

## Problem Statement

The plan `conductor/2026-04-03-001-feat-rbac-data-scope-refinement-plan.md` states that `DEPT_AND_SUB` and `CUSTOM` data scope logic is still a `TODO` in `auth-middleware.ts`. However, a quick check of the code shows that these cases appear to be implemented with Recursive CTEs and role-based queries.

We need to verify if the current implementation is complete, correct, and matches the technical decisions in the plan. If it is, we should update the plan's checkboxes.

## Findings

- `apps/portal/src/lib/auth-middleware.ts` contains implementation for `DEPT_AND_SUB` using PostgreSQL Recursive CTE.
- It also contains `CUSTOM` logic querying `role_data_scopes`.
- The `conductor` plan still has these items as unchecked `[ ]`.

## Proposed Solutions

### Option 1: Thorough Verification and Plan Update

**Approach:**
1. Write/Run tests to confirm `DEPT_AND_SUB` correctly identifies child departments.
2. Confirm `CUSTOM` correctly filters by `role_data_scopes`.
3. If successful, mark the plan units as complete.

**Effort:** 1 hour
**Risk:** Low

## Acceptance Criteria

- [x] Unit tests for `checkDataScope` pass for all types.
- [x] `conductor` plan updated to reflect actual status.

## Work Log

### 2026-04-07 - Initial Discovery

**By:** Gemini CLI
- Noticed discrepancy between code and plan.
- Created this todo to track verification.

### 2026-04-17 - Verification Complete

**By:** Gemini CLI
- Ran `scripts/verify-rbac-data-scope.ts` which verified `DEPT_AND_SUB` and `CUSTOM` logic successfully.
- Fixed a bug in `auth-middleware.ts` where `result.rows.length` was throwing an error with `postgres-js`.
- Marked this task as completed.
