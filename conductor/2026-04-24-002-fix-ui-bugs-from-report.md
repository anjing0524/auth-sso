# Fix UI Bugs and Security Issues from Manual Simulation Report

---
title: Fix UI Bugs and Security Issues from Manual Simulation Report
type: feat
status: approved
date: 2026-04-24
---

<!-- /autoplan restore point: /Users/liushuo/.gstack/projects/anjing0524-auth-sso/main-autoplan-restore-20260424-135348.md -->

## Objective
Address the critical and medium severity issues identified in the `manual-simulation-report.md` to ensure a robust and secure UI/UX, incorporating gstack /autoplan recommendations.

## Local Reproduction
1. `pnpm dev` - Start all services.
2. Visit `http://localhost:4100/users/new` -> Observe "User Not Found".
3. Visit `http://localhost:4100/clients/new` -> Observe "Client Not Found".
4. Try to create a menu as admin -> Observe 403 Forbidden.
5. Inspect IdP login form HTML -> Observe missing `method="POST"`.

## Scope & Implementation Strategy

### 1. Permission Model Reframing (SuperAdmin Bypass)
- **Problem**: Admin role lacks specific permissions (`menu:create`, etc.) and exact string matching fails for wildcards.
- **Solution**: Modify `checkPermission` middleware to automatically grant access if the user has the `ADMIN` role.
- **Files**: `apps/portal/src/lib/auth-middleware.ts`.

### 2. Fix Dynamic Route Conflicts (Explicit Routing)
- **Problem**: Next.js dynamic routes `[id]` intercept `/new` paths.
- **Solution**: Create dedicated `new/page.tsx` files.
- **Strategy**: Refactor common form logic into reusable components to avoid duplication.
- **Files**: 
  - `apps/portal/src/app/users/new/page.tsx`
  - `apps/portal/src/app/clients/new/page.tsx`
  - Refactor `apps/portal/src/app/users/[id]/page.tsx` logic.

### 3. Security Hardening (IdP POST Enforcement)
- **Problem**: `SignInForm` can fallback to GET, exposing credentials.
- **Solution**: Add `method="POST"` to `<form>` and harden server-side to reject GET on auth endpoints if possible.
- **Files**: `apps/idp/src/app/sign-in/sign-in-form.tsx`.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|-----------|-----------|----------|
| 1 | CEO | Use Approach 1 (New files) for routing | Taste | P5 | Explicit routes reduce cognitive load. |
| 2 | CEO | Propose `isSuperAdmin` bypass | User Challenge | P4 | Wildcards aren't supported; bypass is idiomatic. |
| 3 | Eng | Refactor `UserForm` for reuse | Mechanical | P4 | Prevents code duplication between new/edit views. |
| 4 | Eng | Explicitly add `method="POST"` | Mechanical | P5 | Standard security hardening against JS failure. |

## Verification
- Visit `/users/new` and `/clients/new` -> Confirm forms load.
- Create a menu item as admin -> Confirm success (via bypass).
- Check IdP login form HTML source -> Confirm `method="POST"`.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | **CLEAN** | selective expansion, bypass logic approved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | **CLEAN** | refactoring & security hardening required |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | **CLEAN** | reproduction steps added |

**VERDICT: CEO + ENG + DX CLEARED — Ready to implement.**