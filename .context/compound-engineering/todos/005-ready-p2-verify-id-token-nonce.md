---
status: pending
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

## Proposed Solutions

### Option 1: Implement nonce validation in Portal callback

**Approach:** 
1. Store nonce in session/txn before redirecting to IdP.
2. Validate that the `id_token` returned by IdP contains the same `nonce`.

**Effort:** 1-2 hours
**Risk:** High (Critical for OIDC security)

## Acceptance Criteria

- [ ] Authentication fails if `nonce` in `id_token` does not match the stored `nonce`.

## Work Log

### 2026-04-07 - Initial Discovery

**By:** Gemini CLI
- Identified missing nonce verification from security checklist.
