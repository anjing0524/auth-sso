# System Architecture - Auth-SSO

Version: v3.0
Status: Released

---

## 1. System Overview

Auth-SSO is a unified identity and access management (IAM) system built on top of `Next.js` and `Better Auth`. It follows a **decentralized, stateless JWT Cookie** architecture with a custom Rust-based API Gateway. The system consists of three primary applications and shared libraries.

- **`apps/portal` (Portal)**: The enterprise portal, BFF (Backend for Frontend), and OIDC Provider. Portal itself IS the identity provider — it runs Better Auth with the OIDC Provider plugin, handles user authentication, token issuance (ES256 JWT), manages business logic (RBAC, organizational structure), and writes JWT tokens into HttpOnly Cookies.
- **`apps/gateway` (Gateway)**: A high-performance API Gateway built with Rust (Pingora). It serves as the unified traffic entry point, performs offline JWT signature verification using cached JWKS public keys, and transforms Cookie-based auth into Bearer tokens for downstream microservices.
- **`packages/contracts`**: Shared TypeScript types, error codes, permission codes, and OIDC constants.
- **`packages/config`**: Shared env config (Zod schema + URL derivation), TypeScript/ESLint configuration.

---

## 2. Technical Stack

- **Framework**: Next.js 16 (App Router, Turbopack).
- **Identity Engine**: [Better Auth](https://better-auth.com/) (Email/Password, OIDC 2.1 Provider).
- **API Gateway**: Rust + Pingora (ES256 JWKS offline verification, Cookie-to-Bearer transformation).
- **Database**: PostgreSQL 16+ (shared across Portal auth and business domains).
- **ORM**: Drizzle ORM.
- **Redis**: jti blocklist (Portal emergency revocation), permission context cache (Portal), Better Auth session storage (secondaryStorage).
- **Styling**: Tailwind CSS 4, shadcn/ui.
- **Language**: TypeScript (Portal), Rust (Gateway).

---

## 3. High-Level Architecture

```text
Browser
  → Gateway (Rust/Pingora)
       → ES256 offline JWT verification (JWKS cached, zero network I/O)
       → Cookie extraction + Bearer header injection
       → Route to Portal
  → Portal (BFF + OIDC Provider)
       → PostgreSQL (Portal Core Domain: RBAC, Org Structure, Auth: users, sessions, tokens)
       → Redis (jti blocklist, permission cache, Better Auth secondaryStorage)
  → Sub-Applications (OIDC Clients)
       → Portal OIDC Provider (Authorize/Token)
```

### 3.1 Component Responsibilities

| Component | Core Responsibilities | Must NOT Do |
| --- | --- | --- |
| **Portal (BFF + OIDC Provider)** | 1. User credential verification (Better Auth)<br/>2. Issue ES256-signed JWT (Access Token + Refresh Token)<br/>3. Expose `/.well-known/jwks` public key endpoint<br/>4. Maintain sessions for cross-app SSO<br/>5. RBAC pre-check at authorization endpoint<br/>6. Act as OIDC Client for internal SSO<br/>7. Write JWT into HttpOnly Cookies (`portal_jwt_token`, `portal_refresh_token`)<br/>8. Manage Users, Departments, Roles, Permissions<br/>9. Implement RBAC with Data Scope filtering<br/>10. jti blacklist for emergency token revocation | 1. Never store session state in Redis for Portal API auth (stateless JWT)<br/>2. Never expose sensitive tokens to client-side JS |
| **Gateway (Pingora)** | 1. Unified HTTPS traffic entry point with SNI routing<br/>2. Extract `portal_jwt_token` Cookie, verify via cached JWKS<br/>3. Strip Cookie, inject `Authorization: Bearer <JWT>` for downstream<br/>4. Zero-trust: 100% offline verification, no Redis/DB I/O | 1. Never perform business-level permission checks<br/>2. Never connect to Redis or database<br/>3. Never handle login/redirect logic |
| **Microservices** | 1. Pure business logic and data persistence<br/>2. Independently verify JWT via Portal JWKS (zero-trust)<br/>3. Enforce interface-level and data-level permission checks | 1. Never implement OIDC Authorization Code / PKCE logic<br/>2. Never manage user sessions directly |
| **Demo App** | 1. Demonstrate standard OIDC Client integration<br/>2. Test SSO cross-app login/logout flows | — |

### 3.2 Architecture Constraint: Unified Database (v1.0+)

> **Architecture note**: The OIDC Provider functionality (formerly a separate IDP service) has been fully merged into Portal. The authorization endpoint (`/api/auth/oauth2/authorize`) now queries Portal domain tables (`users`, `roles`, `userRoles`, `roleClients`) directly within the same application. All data lives in a single PostgreSQL instance managed by Portal.

---

## 4. Authentication & SSO Flows

### 4.1 Portal Login Flow

1. User accesses Portal protected page.
2. Portal BFF (`/api/auth/login`) generates PKCE parameters (code_verifier, code_challenge, state, nonce) and redirects to Portal `/authorize` endpoint.
3. User logs in at Portal (email/password).
4. Portal redirects back to Portal `/api/auth/callback` with an authorization `code`.
5. Portal BFF exchanges `code` for `access_token` (ES256 JWT) and `refresh_token` via Portal `/token` endpoint (Back-Channel).
6. Portal BFF writes tokens into HttpOnly Cookies:
   - `portal_jwt_token`: Access Token (HttpOnly, Secure, SameSite=Lax, maxAge = token expires_in)
   - `portal_refresh_token`: Refresh Token (HttpOnly, Secure, SameSite=Lax, path = `/api/auth/refresh`, maxAge = 7 days)
7. Portal BFF redirects user to the target page (e.g., `/dashboard`).

### 4.2 Single Sign-On (SSO) Flow

1. User accesses a Sub-Application (an OIDC client registered with Portal).
2. Sub-app redirects to Portal `/authorize`.
3. Browser automatically sends the `idp_session` cookie (Better Auth session).
4. Portal recognizes the session and redirects back to Sub-app with a `code` (skipping the login UI).
5. Sub-app exchanges `code` for tokens and establishes its own session.

### 4.3 Gateway Request Flow

1. Browser sends API request with `portal_jwt_token` Cookie.
2. Gateway extracts JWT from Cookie, verifies signature using cached JWKS public key (ES256, offline, zero network I/O).
3. On success: Gateway strips Cookie header, injects `Authorization: Bearer <JWT>`, forwards to downstream microservice.
4. On failure: Gateway returns 401, browser redirects to Portal login.

---

## 5. Session Management

### 5.1 Dual-Session Model (Stateless Portal + Stateful Portal)

| | Portal Session | Portal Session |
|---|---|---|
| **Manager** | Portal BFF (OIDC Client) | Better Auth native |
| **Storage** | Stateless JWT in HttpOnly Cookie | Redis (`auth-sso:` prefix via Better Auth secondaryStorage) |
| **Key Files** | `apps/portal/src/lib/session.ts` | `apps/idp/src/lib/auth.ts` |
| **Identifier** | `portal_jwt_token` cookie | `better-auth.session_token` cookie |
| **Timeout** | JWT exp (1h) + Refresh Token (7d) | Better Auth managed |

### 5.2 Token Lifecycle

| Token Type | Lifetime | Storage | Purpose |
|---|---|---|---|
| Access Token (JWT) | 1 hour (Portal OIDC Provider config) | `portal_jwt_token` HttpOnly Cookie | Authentication + Authorization claims |
| Refresh Token | 7 days (Portal Cookie) | `portal_refresh_token` HttpOnly Cookie (path-restricted) | Silent token renewal via `/api/auth/refresh` |
| Portal Session | Better Auth managed | Redis (`auth-sso:` prefix) | Cross-application SSO session |

### 5.3 Token Refresh Mechanism

Portal SPA frontend uses a timer to call `/api/auth/refresh` before the Access Token expires (5 minutes prior). On success, Portal BFF obtains a new Access Token from Portal and updates the `portal_jwt_token` Cookie. On failure (Refresh Token expired/revoked), user is redirected to login.

### 5.4 Emergency Revocation (jti Blacklist)

For scenarios requiring immediate token invalidation (account ban, password change, forced logout):

1. Portal writes the JWT's `jti` to Redis with TTL = token's remaining lifetime.
2. All Portal API routes check the jti blacklist during JWT verification (`verifyJwt()`).
3. Gateway can subscribe to Redis Pub/Sub for jti broadcasts (optional, for sub-second revocation).

---

## 6. Better Auth Integration

The Portal application (`apps/idp`) uses Better Auth with the following plugins:
- **Core Auth**: Basic user management and authentication.
- **Email & Password**: Primary credential provider.
- **OIDC Provider**: Implements OIDC/OAuth 2.1 endpoints.
- **JWT**: For signing ID Tokens and providing JWKS.

### 6.1 OIDC Endpoints (Provided by Better Auth)

All standard OIDC endpoints are handled by Better Auth's catch-all route (`/api/auth/[...all]`):

| Endpoint | Path | Provided By |
|---|---|---|
| Authorization | `/api/auth/oauth2/authorize` | Custom handler + Better Auth fallback |
| Token Exchange | `/api/auth/oauth2/token` | Better Auth built-in |
| Token Revocation | `/api/auth/oauth2/revoke` | Better Auth built-in |
| Token Introspection | `/api/auth/oauth2/introspect` | Better Auth built-in |
| UserInfo | `/api/auth/oauth2/userinfo` | Better Auth built-in |
| JWKS | `/api/auth/jwks` | Better Auth JWT plugin |
| Discovery | `/api/auth/.well-known/openid-configuration` | Better Auth built-in |
| Global SSO Logout | `/api/auth/sign-out-sso` | Custom handler |

### 6.2 Portal-Portal User Linking

- When a user is created in the Portal, a corresponding identity record is created in the Portal.
- The `sub` (subject) claim in OIDC tokens links the Portal identity to the business user in the Portal domain.
- Both domains share a single PostgreSQL database for v1.0 simplicity.

---

## 7. Security Principles

1. **PKCE (Proof Key for Code Exchange)**: Mandatory for all authorization code flows (`requirePKCE: true`, S256 only).
2. **State & Nonce**: Used to prevent CSRF and replay attacks.
3. **Cookie Hardening**: `HttpOnly`, `Secure`, `SameSite=Lax` for all auth cookies.
4. **Token Isolation**: No sensitive tokens (Access/Refresh) are exposed to client-side JavaScript.
5. **Back-Channel Communication**: Token exchange and refresh occur server-to-server.
6. **Zero-Trust Architecture**: Gateway and microservices independently verify JWT signatures via JWKS. No service trusts headers from another service without verification.
7. **Global Logout**: Logging out from Portal invalidates both Portal JWT (jti blacklist) and Portal session, ensuring subsequent SSO attempts require re-authentication.
8. **Emergency Revocation**: jti blacklist in Redis enables sub-second forced logout without waiting for token expiration.
