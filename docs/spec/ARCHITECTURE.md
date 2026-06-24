# System Architecture -- Auth-SSO

**Version:** v5.0
**Status:** Released
**Last Updated:** 2026-06-24

---

## 1. System Overview

Auth-SSO is a unified identity and access management (IAM) platform built on Next.js 16. It follows a **stateless JWT Cookie** architecture with a custom Rust-based API Gateway. The platform consists of two primary applications and two shared packages.

| Component | Role | Technology |
|---|---|---|
| **Portal** (`apps/portal`) | Enterprise admin portal, BFF, and OIDC Provider -- all in one process | Next.js 16 + TypeScript |
| **Gateway** (`apps/gateway`) | Unified HTTPS entry point, offline JWT verification, Cookie-to-Bearer transformation | Rust + Pingora |
| **`packages/contracts`** | Shared TypeScript types, error codes, permission codes, OIDC constants | TypeScript |
| **`packages/config`** | Shared environment configuration (Zod schema + URL derivation), TypeScript/ESLint presets | TypeScript |

The Portal **is** the identity provider. There is no separate IdP service. User authentication, token issuance (ES256 JWT), OIDC protocol handling, RBAC, organizational structure management, and audit logging all live in a single Next.js application. The Gateway provides a lightweight, low-latency auth enforcement layer in front of downstream microservices.

---

## 2. Technical Stack

| Category | Choice | Rationale |
|---|---|---|
| **Framework** | Next.js 16 (App Router, Turbopack) | Full-stack RSC, server actions, route handlers |
| **Auth Engine** | Pure custom implementation via `jose` library | Full control over OIDC flows, no framework lock-in |
| **JWT Signing** | ES256 (ECDSA P-256), keys stored in PostgreSQL `jwks` table | Asymmetric -- offline verification, no shared secret |
| **API Gateway** | Rust + Pingora | High concurrency, zero-cost abstractions, offline JWKS verification |
| **Database** | PostgreSQL 16+ | Shared across auth and business domains |
| **ORM** | Drizzle ORM | Direct query pattern, type-safe, no repository abstraction |
| **Cache / Blocklist** | Redis (ioredis) | jti blocklist (emergency revocation) + permission context cache (5-min TTL) |
| **Styling** | Tailwind CSS 4 + shadcn/ui | Utility-first, component library |
| **Package Manager** | pnpm workspaces | Monorepo management, strict dependency isolation |

---

## 3. High-Level Architecture

```
Browser
  |
  v
Gateway (Rust/Pingora)
  |-- ES256 offline JWT verification (in-memory JWKS cache)
  |-- Cookie extraction + Bearer header injection
  |-- Route to Portal or downstream microservices
  |
  v
Portal (BFF + OIDC Provider + Admin UI)
  |-- PostgreSQL 16+ (users, roles, permissions, departments, clients, jwks, refresh_tokens)
  |-- Redis (jti blocklist, permission cache)
  |
  v
Sub-Applications (OIDC Clients)
  |-- OAuth 2.1 Authorization Code + PKCE flow via Portal
```

### 3.1 Component Responsibilities

| Component | Core Responsibilities | Must NOT Do |
|---|---|---|
| **Portal** | (1) User credential verification (bcrypt, DB-stored password hash). (2) Issue ES256-signed JWT via DB-stored key pairs. (3) Expose `/.well-known/jwks` and `/api/auth/jwks`. (4) OAuth 2.1 + OIDC Provider endpoints (authorize, token, userinfo, introspect, revoke). (5) Write JWT into HttpOnly Cookies (`portal_jwt_token`, `portal_refresh_token`). (6) Manage users, departments, roles, permissions, OAuth clients. (7) RBAC with data scope filtering (`SELF`, `DEPT`, `DEPT_AND_SUB`, `ALL`). (8) jti blacklist for emergency token revocation. (9) Audit logging | Never store session state in Redis for Portal API auth (stateless JWT). Never expose sensitive tokens to client-side JavaScript |
| **Gateway** | (1) Unified HTTPS traffic entry point. (2) Extract `portal_jwt_token` Cookie, verify via cached JWKS (ES256, offline). (3) Strip Cookie, inject `Authorization: Bearer <JWT>` for downstream. (4) Zero-trust: 100% offline verification, no Redis/DB I/O | Never perform business-level permission checks. Never connect to Redis or database. Never handle login/redirect logic |

### 3.2 Portal Internal Architecture (Layered DDD)

The Portal follows a four-layer architecture with strict dependency direction:

```
app/ (Controller Layer - Next.js App Router)
  |-- (dashboard)/          Admin UI pages (route group)
  |     |-- users/          Server Actions, data.ts (read), actions.ts (write)
  |     |-- roles/          Same pattern
  |     |-- clients/        Same pattern
  |     |-- departments/    Same pattern
  |     |-- permissions/    Same pattern
  |     |-- audit-logs/     Same pattern
  |     |-- dashboard/      Dashboard page
  |-- api/auth/             OIDC Provider Route Handlers
  |     |-- oauth2/authorize, token, userinfo, introspect, revoke
  |     |-- login, logout, callback, refresh, jwks
  |-- login/                Login page
  |-- profile/              User profile page
  |
  v
domain/ (Domain Layer - Pure TypeScript, zero framework dependency)
  |-- auth/         login.ts, password.ts, oauth-authorize.ts, oauth-code.ts, oauth-client.ts, types.ts
  |-- user/         User CRUD pure functions (userToInsertRow, userToUpdateRow)
  |-- role/         Role CRUD pure functions
  |-- permission/   Permission CRUD pure functions
  |-- department/   Department CRUD + circular reference detection
  |-- client/       OAuth Client CRUD pure functions
  |-- shared/       DomainError, error-mapping, zod-schemas, tree-utils
  |
  v
lib/ (Stateless Utilities - can import from domain/)
  |-- auth/         token.ts (JWT sign/verify), verify-jwt.ts, pkce.ts, guard.ts,
  |                 check-permission.ts, data-scope.ts, facade.ts, index.ts
  |-- session/      jwt.ts, cookies.ts (Cookie read/write), revoke.ts, index.ts
  |-- permissions.ts     Permission context query + Redis cache
  |-- crypto.ts          ID/Secret generation
  |-- oauth-utils.ts     OAuth utility helpers
  |-- menu-tree.ts       Menu tree building (pure transformation)
  |-- audit.ts           Audit logging
  |-- type-guards.ts     Runtime type guards
  |-- env.ts             Environment variable access
  |-- utils.ts           General-purpose utilities
  |
  v
infrastructure/ (Stateful Adapters - can import from lib/ and domain/)
  |-- db/    index.ts     Drizzle ORM + postgres-js (single connection pool)
  |-- redis/ index.ts     ioredis client (jti blocklist, permission cache)
  |-- auth/  (empty)      Placeholder for future infrastructure-level auth adapters
```

**Layer Dependency Rules (enforced by convention):**

| Layer | Dependencies Allowed |
|---|---|
| `domain/` | Zero external dependencies (no `next/`, `react`, DB, or npm packages except `jose` and `bcryptjs` for pure functions) |
| `lib/` | Can import from `domain/` and `infrastructure/` (for cache/DB access) |
| `infrastructure/` | Can import from `lib/` and `domain/` |
| `app/` | Can import from all layers |

**CQRS Pattern in Practice:**

Within each `app/` sub-module, concerns are separated into three file types:

- **`data.ts`** -- Read model. Direct Drizzle queries that return serialized data for UI rendering. No mutations.
- **`actions.ts`** -- Write model. Server Actions that accept form data, validate, authorize, and mutate via Drizzle. Calls `domain/` pure functions for business logic.
- **`route.ts`** -- External integration endpoints (REST API, webhooks). Used only where Server Actions are insufficient.

---

## 4. Authentication & SSO Flows

### 4.1 Portal Login Flow (OAuth 2.1 Authorization Code + PKCE)

```
1. [Browser]     GET /login
2. [Portal]      Renders login page
3. [User]        Submits email + password
4. [Portal]      POST /api/auth/login
                    |- Validates credentials (bcrypt compare)
                    |- Signs login_session JWT (ES256, 5-min TTL)
                    |- Sets login_session HttpOnly Cookie
                    |- Redirects to /api/auth/oauth2/authorize?response_type=code&...
5. [Portal]      GET /api/auth/oauth2/authorize
                    |- Validates login_session Cookie
                    |- Verifies PKCE code_challenge (S256)
                    |- Issues authorization code (opaque, DB-stored, 1-min TTL)
                    |- Redirects to callback with ?code=...
6. [Portal]      GET /api/auth/callback?code=...
                    |- Exchanges code for tokens (back-channel, POST to /api/auth/oauth2/token)
                    |- Writes tokens to HttpOnly Cookies:
                       portal_jwt_token    (ES256 JWT, HttpOnly Secure SameSite=Lax, maxAge=1h)
                       portal_refresh_token (opaque, HttpOnly Secure SameSite=Lax, path=/api/auth/refresh, maxAge=7d)
                    |- Redirects to / (dashboard)
```

**Architecture note:** Portal is both the BFF and the OIDC Provider in a single process. The login flow is a single-app flow -- no cross-service redirects after the initial login.

### 4.2 Single Sign-On (SSO) Flow

1. User accesses a sub-application (OIDC client registered with Portal).
2. Sub-app redirects to Portal's `/api/auth/oauth2/authorize` with appropriate OIDC parameters.
3. Browser sends `portal_jwt_token` Cookie if the user already has an active session.
4. Portal verifies the JWT. If valid, skips login UI and immediately issues an authorization code.
5. Sub-app exchanges the code for tokens (back-channel) and establishes its own session.

### 4.3 Gateway Request Flow

1. Browser sends API request with `portal_jwt_token` Cookie.
2. Gateway extracts the JWT from the Cookie header.
3. Gateway verifies the JWT signature using an in-memory JWKS cache (ES256, 100% offline).
4. On success: strips the Cookie header, injects `Authorization: Bearer <JWT>`, forwards to downstream.
5. On failure: returns `401` with `WWW-Authenticate: Bearer` header.

### 4.4 Token Refresh Flow

1. Client detects Access Token is nearing expiry (or receives a 401).
2. Client calls `POST /api/auth/refresh` -- the `portal_refresh_token` Cookie is sent automatically.
3. Server validates the Refresh Token against the database, rotates it (revoke old + issue new pair).
4. New `portal_jwt_token` and `portal_refresh_token` are written to Cookies.
5. On failure (expired, revoked, or tampered): all auth cookies are cleared, user is redirected to login.

---

## 5. Token & Key Management

### 5.1 JWKS Key Management

- **Key generation**: ES256 (ECDSA P-256) key pairs are generated on first request if none exist in the `jwks` table.
- **Storage**: Private keys are encrypted at rest in PostgreSQL. Public keys are stored as plain JWK.
- **Rotation**: If the active key exceeds 90 days of age, a new key pair is generated and becomes the primary signing key.
- **Exposure**: Public keys are served via `GET /.well-known/jwks` (OIDC discovery) and `GET /api/auth/jwks` (direct access).
- **Gateway consumption**: Gateway fetches JWKS on startup and caches in-memory. Does periodic refresh. Zero I/O per request.

### 5.2 Token Types

| Token | Signing | Lifetime | Storage | Purpose |
|---|---|---|---|---|
| **Login Session Token** | ES256 JWT | 5 minutes | `login_session` HttpOnly Cookie | Temporary credential carried from login to authorize endpoint |
| **Access Token** | ES256 JWT | 1 hour | `portal_jwt_token` HttpOnly Cookie | Authentication + authorization (roles, permissions, data scope) |
| **Refresh Token** | Opaque (DB-stored) | 7 days | `portal_refresh_token` HttpOnly Cookie | Silent token renewal |

**JWT payload** (Access Token) includes: `sub` (user ID), `email`, `roleId`, `permissions` array, `dataScope`, `jti`, `iat`, `exp`.

### 5.3 Emergency Revocation (jti Blacklist)

For scenarios requiring immediate token invalidation (account suspension, forced logout, security incident):

1. The JWT's `jti` is written to Redis with a TTL equal to the token's remaining lifetime.
2. All JWT verification paths consult the Redis blocklist before accepting a token.
3. `revokeUserToken()` in `lib/session/revoke.ts` revokes all Refresh Tokens for a user by deleting them from the database.
4. This is a **derogation** of the stateless principle -- used only for emergency scenarios, never in normal flow.

---

## 6. OIDC Provider Endpoints

All endpoints are **custom implementations** (no third-party OIDC library). Implemented as Next.js Route Handlers in `src/app/api/auth/`.

| Endpoint | Method | Path | Specification |
|---|---|---|---|
| Authorization | GET | `/api/auth/oauth2/authorize` | OAuth 2.1 Authorization Code + PKCE entry point |
| Token | POST | `/api/auth/oauth2/token` | Token exchange (code -> access_token + refresh_token) |
| UserInfo | GET | `/api/auth/oauth2/userinfo` | OIDC UserInfo (OpenID Connect Core 1.0) |
| Introspection | POST | `/api/auth/oauth2/introspect` | Token introspection (RFC 7662) |
| Revocation | POST | `/api/auth/oauth2/revoke` | Token revocation (RFC 7009) |
| JWKS | GET | `/api/auth/jwks` | Public key set for JWT verification |
| Callback | GET | `/api/auth/callback` | OAuth post-authorization callback handler |
| Login | POST | `/api/auth/login` | Email/password credential verification |
| Logout | POST | `/api/auth/logout` | Clear cookies + revoke tokens |
| Refresh | POST | `/api/auth/refresh` | Token refresh (rotate access + refresh token pair) |

---

## 7. Security Principles

| # | Principle | Implementation |
|---|---|---|
| 1 | **PKCE (S256)** | Mandatory for all authorization code flows. `code_challenge_method` is always `S256`. |
| 2 | **State & Nonce** | `state` prevents CSRF on the authorization callback. `nonce` prevents replay attacks on the token exchange. |
| 3 | **Cookie Hardening** | All auth cookies set `HttpOnly`, `Secure` (locally downgraded in dev), `SameSite=Lax`. |
| 4 | **Token Isolation** | No sensitive tokens exposed to client-side JavaScript. Access tokens are exchanged server-side. |
| 5 | **Back-Channel Communication** | Token exchange (`code` for tokens) and token refresh are server-to-server. Authorization codes travel through the browser but are single-use and short-lived (1 min). |
| 6 | **Zero-Trust Gateway** | Gateway and downstream microservices independently verify JWT signatures via JWKS. No trust delegation. |
| 7 | **Stateless Core** | Portal API auth is 100% stateless JWT. No Redis session lookup on the hot path. |
| 8 | **Emergency Revocation** | Redis-based jti blocklist for immediate token invalidation in security incidents. |
| 9 | **ES256 Asymmetric Signing** | Private key stored encrypted in PostgreSQL. Public key exposed via JWKS. No shared secrets between services. |
| 10 | **Audit Trail** | All auth-sensitive operations (login, logout, token refresh, permission changes) are logged to the `audit_logs` table. |

---

## 8. Package Dependencies

```
auth-sso/
  |-- apps/
  |     |-- portal/       Next.js 16 app (depends on contracts, config)
  |     |-- gateway/      Rust/Pingora binary (reads JWKS from Portal endpoint)
  |
  |-- packages/
  |     |-- contracts/    Shared types, error codes, permission codes, OIDC constants
  |     |-- config/       Zod env schema, URL derivation, TypeScript/ESLint configs
  |
  |-- scripts/            Utility scripts (seed data, maintenance)
  |-- tests/              E2E (Playwright), integration, traceability
```

- `packages/contracts` is the single source of truth for all permission codes, error code enums, and OIDC constant values. It has **zero runtime dependencies**.
- `packages/config` exports a validated environment configuration object derived from `process.env` via Zod. It has no dependency on Portal internals.
- The Portal depends on both packages. The Gateway is independent (Rust) and reads Portal's JWKS endpoint at startup.

---

## Appendix: Key File Map

| Path | Purpose |
|---|---|
| `apps/portal/src/domain/auth/login.ts` | Login credential validation (pure function) |
| `apps/portal/src/domain/auth/oauth-authorize.ts` | Authorization code issuance logic |
| `apps/portal/src/domain/auth/oauth-code.ts` | Authorization code lifecycle (create, consume, expire) |
| `apps/portal/src/lib/auth/token.ts` | JWT signing and verification (jose + JWKS) |
| `apps/portal/src/lib/auth/verify-jwt.ts` | JWT payload decoding and validation |
| `apps/portal/src/lib/auth/guard.ts` | Request-level auth guard HOC |
| `apps/portal/src/lib/auth/check-permission.ts` | Permission assertion helpers |
| `apps/portal/src/lib/auth/data-scope.ts` | Data scope filtering (SELF/DEPT/DEPT_AND_SUB/ALL) |
| `apps/portal/src/lib/auth/facade.ts` | Unified auth facade combining guard + permission check |
| `apps/portal/src/lib/session/cookies.ts` | Cookie read/write utilities |
| `apps/portal/src/lib/session/jwt.ts` | Session JWT-specific helper |
| `apps/portal/src/lib/session/revoke.ts` | Token revocation logic |
| `apps/portal/src/lib/permissions.ts` | Permission context query + Redis cache layer |
| `apps/portal/src/lib/crypto.ts` | ID/Secret random generation |
| `apps/portal/src/infrastructure/db/index.ts` | Drizzle + postgres-js connection pool |
| `apps/portal/src/infrastructure/redis/index.ts` | ioredis client singleton |
