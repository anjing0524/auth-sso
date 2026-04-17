---
status: completed
priority: p2
issue_id: "005"
tags: [security, oidc]
dependencies: []
---

# Verify id_token nonce in authentication flow

## Problem Statement

`docs/security-checklist.md` identifies a pending task: "Verify nonce claim in id_token". This is a critical security check in OIDC to prevent replay attacks.

## Findings

- Mentioned as "To be improved" in `docs/security-checklist.md`.
- `apps/portal/src/app/api/auth/login/route.ts` was already generating and sending a `nonce`.
- `apps/portal/src/app/api/auth/callback/route.ts` was decoding the `id_token` but not verifying the `nonce`.

## Proposed Solutions

### Option 1: Implement nonce validation in Portal callback

**Approach:** 
1. Store nonce in session/txn (via `oauth_state_data` cookie) before redirecting to IdP.
2. Validate that the `id_token` returned by IdP contains the same `nonce`.

**Effort:** 1-2 hours
**Risk:** High (Critical for OIDC security)

## Acceptance Criteria

- [x] Authentication fails if `nonce` in `id_token` does not match the stored `nonce`.

## Work Log

### 2026-04-07 - Initial Discovery

**By:** Gemini CLI
- Identified missing nonce verification from security checklist.

### 2026-04-17 - Implementation Complete

**By:** Gemini CLI
- Implemented `nonce` claim verification in `apps/portal/src/app/api/auth/callback/route.ts`.
- The `nonce` is retrieved from the `oauth_state_data` cookie and compared against the `nonce` in the decoded `id_token`.
- Added logging for debugging and audit purposes.

