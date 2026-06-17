# System Architecture - Auth-SSO

Version: v4.0
Status: Released
Last Updated: 2026-06-16

---

## 1. System Overview

Auth-SSO is a unified identity and access management (IAM) system built on Next.js. It follows a **decentralized, stateless JWT Cookie** architecture with a custom Rust-based API Gateway (Pingora). The system consists of two primary applications and shared packages.

- **`apps/portal` (Portal)**: The enterprise portal, BFF (Backend for Frontend), and custom OIDC Provider. Portal itself IS the identity provider — it handles user authentication, token issuance (ES256 JWT using jose and DB-stored JWKS), manages business logic (RBAC, organizational structure), and writes JWT tokens into HttpOnly Cookies.
- **`apps/gateway` (Gateway)**: A high-performance API Gateway built with Rust (Pingora). It serves as the unified traffic entry point, performs offline JWT signature verification using cached JWKS public keys, and transforms Cookie-based auth into Bearer tokens for downstream microservices.
- **`packages/contracts`**: Shared TypeScript types, error codes, permission codes, OIDC constants. Single source of truth for all enum values.
- **`packages/config`**: Shared env config (Zod schema + URL derivation), TypeScript/ESLint configuration.

---

## 2. Technical Stack

- **Framework**: Next.js 16 (App Router, Turbopack).
- **Auth Engine**: Custom OIDC Provider implementation — pure JWT Cookie stateless architecture. No Better Auth dependency.
- **JWT Signing**: ES256 asymmetric keys stored in PostgreSQL (`jwks` table), signed via Web Crypto API (`jose` library).
- **API Gateway**: Rust + Pingora (ES256 JWKS offline verification, Cookie-to-Bearer transformation).
- **Database**: PostgreSQL 16+ (shared across Portal auth and business domains).
- **ORM**: Drizzle ORM (direct query pattern, no repository abstraction).
- **Redis**: jti blocklist (emergency token revocation) and permission context cache (5-min TTL).
- **Styling**: Tailwind CSS 4, shadcn/ui components.
- **Language**: TypeScript (Portal), Rust (Gateway).
- **Package Manager**: pnpm workspaces.

---

## 3. High-Level Architecture

```text
Browser
  → Gateway (Rust/Pingora)
       → ES256 offline JWT verification (JWKS cached in-memory)
       → Cookie extraction + Bearer header injection
       → Route to Portal
  → Portal (BFF + OIDC Provider + Admin UI)
       → PostgreSQL (Users, Roles, Permissions, Departments, Menus, Clients, JWKS keys, Refresh Tokens)
       → Redis (jti blocklist, permission context cache)
  → Sub-Applications (OIDC Clients)
       → Portal OIDC Provider (Authorize / Token / UserInfo / Introspect / Revoke)
```

### 3.1 Component Responsibilities

| Component | Core Responsibilities | Must NOT Do |
| --- | --- | --- |
| **Portal** | 1. User credential verification (bcrypt, DB-stored password hash)<br/>2. Issue ES256-signed JWT via DB-stored key pairs<br/>3. Expose `/.well-known/jwks` and `/api/auth/jwks` endpoints<br/>4. OAuth 2.1 + OIDC Provider endpoints (authorize, token, userinfo, introspect, revoke)<br/>5. Write JWT into HttpOnly Cookies (`portal_jwt_token`, `portal_refresh_token`)<br/>6. Manage Users, Departments, Roles, Permissions, Menus, OAuth Clients<br/>7. RBAC with Data Scope filtering (`SELF`, `DEPT`, `DEPT_AND_SUB`, `ALL`)<br/>8. jti blacklist for emergency token revocation | 1. Never store session state in Redis for Portal API auth (stateless JWT)<br/>2. Never expose sensitive tokens to client-side JS |
| **Gateway** | 1. Unified HTTPS traffic entry point<br/>2. Extract `portal_jwt_token` Cookie, verify via cached JWKS (ES256, offline)<br/>3. Strip Cookie, inject `Authorization: Bearer <JWT>` for downstream<br/>4. Zero-trust: 100% offline verification, no Redis/DB I/O | 1. Never perform business-level permission checks<br/>2. Never connect to Redis or database<br/>3. Never handle login/redirect logic |

### 3.2 Portal Internal Architecture (Layered DDD)

```text
app/ (Controller Layer)
  ├── Server Actions (actions.ts) — 内部页面表单用, withAuth HOF 统一鉴权
  ├── Route Handlers (route.ts) — 外部集成/Webhook/OIDC 协议端点
  └── Data Helpers (data.ts) — 读模型 Drizzle 直调查询

domain/ (Domain Layer — 纯 TS, 零框架依赖)
  ├── shared/ — DomainError, error-mapping, zod-schemas, tree-utils
  ├── auth/ — login, password, token (JWT签发/验签), oauth-authorize, types
  ├── user/ — User CRUD 纯函数, userToInsertRow/UpdateRow
  ├── role/ — Role CRUD 纯函数
  ├── permission/ — Permission CRUD 纯函数
  ├── department/ — Department CRUD + 环形引用检测
  ├── menu/ — Menu CRUD + 树构建
  └── client/ — OAuth Client CRUD 纯函数

lib/ (Stateless Utilities)
  ├── auth/ — withAuth, checkPermission, withPermission, data-scope, pkce, verify-jwt
  ├── session/ — JWT Cookie 读写, jwks, revoke
  ├── permissions.ts — 权限上下文查询 + Redis 缓存
  ├── audit.ts — 审计日志
  └── crypto.ts — ID/Secret 生成

infrastructure/ (Stateful Adapters)
  ├── db/ — Drizzle + postgres-js 连接
  └── redis/ — ioredis 客户端
```

**Layer Dependency Rules**:
- `domain/` → zero external dependencies (no next/, react, db, or npm packages except jose/bcryptjs)
- `lib/` → can import from domain/ and infrastructure/
- `infrastructure/` → can import from lib/ and domain/
- `app/` → can import from all layers

---

## 4. Authentication & SSO Flows

### 4.1 Portal Login Flow (OAuth 2.1 Authorization Code + PKCE)

1. User accesses Portal login page (`/login`).
2. Login form POST → Server Action validates credentials (email + password bcrypt).
3. On success: signs `login_session` JWT (5-min TTL, ES256), sets as HttpOnly Cookie.
4. Redirects to `/api/auth/oauth2/authorize` with PKCE parameters (code_challenge, state).
5. Authorize endpoint validates login_session Cookie, checks user status, issues authorization `code`.
6. Callback endpoint (`/api/auth/callback`) exchanges `code` for `access_token` + `refresh_token`.
7. Tokens written to HttpOnly Cookies:
   - `portal_jwt_token`: Access Token (ES256 JWT, HttpOnly, Secure, SameSite=Lax, maxAge=1h)
   - `portal_refresh_token`: Refresh Token (HttpOnly, Secure, SameSite=Lax, path=/api/auth/refresh, maxAge=7d)

### 4.2 Single Sign-On (SSO) Flow

1. User accesses a Sub-Application (OIDC client registered with Portal).
2. Sub-app redirects to Portal `/api/auth/oauth2/authorize`.
3. Browser sends `portal_jwt_token` Cookie if already logged in.
4. Portal verifies JWT, skips login UI, redirects back with authorization `code`.
5. Sub-app exchanges `code` for tokens (back-channel) and establishes its own session.

### 4.3 Gateway Request Flow

1. Browser sends API request with `portal_jwt_token` Cookie.
2. Gateway extracts JWT from Cookie, verifies signature using in-memory JWKS cache (ES256, offline).
3. On success: Gateway strips Cookie header, injects `Authorization: Bearer <JWT>`, forwards downstream.
4. On failure: Gateway returns 401 with `WWW-Authenticate: Bearer` header.

---

## 5. Token & Key Management

### 5.1 JWKS Key Management

- Signing key pairs (ES256) are stored in PostgreSQL `jwks` table (public key + encrypted private key).
- On first request, if no key exists, a new key pair is generated and persisted.
- Keys auto-rotate: if the current key is expired (>90 days), a new key pair is generated.
- Public keys are exposed via `/.well-known/jwks` and `/api/auth/jwks` for Gateway/microservice verification.

### 5.2 Token Types

| Token Type | Signing | Lifetime | Storage | Purpose |
|---|---|---|---|---|
| Login Session Token | ES256 JWT | 5 minutes | `login_session` Cookie | Temporary credential passed to authorize endpoint |
| Access Token | ES256 JWT | 1 hour | `portal_jwt_token` Cookie | Authentication + Authorization (roles, permissions, dataScope) |
| Refresh Token | Opaque (DB-stored) | 7 days | `portal_refresh_token` Cookie | Silent token renewal via `/api/auth/refresh` |

### 5.3 Token Refresh

- Frontend calls `/api/auth/refresh` before Access Token expires.
- Server validates Refresh Token against DB, rotates (revoke old + issue new).
- New Access Token + Refresh Token written to Cookies.
- On failure (expired/revoked), user redirected to login.

### 5.4 Emergency Revocation (jti Blacklist)

- When immediate token invalidation is needed (account ban, forced logout):
  1. JWT's `jti` written to Redis with TTL = token remaining lifetime.
  2. All JWT verification paths check jti blacklist.
  3. `revokeUserToken()` → revokes all Refresh Tokens for a user.

---

## 6. OIDC Provider Endpoints

All custom-implemented (no Better Auth):

| Endpoint | Path | Description |
|---|---|---|
| Authorization | `GET /api/auth/oauth2/authorize` | OAuth 2.1 Authorization Code flow entry |
| Token | `POST /api/auth/oauth2/token` | Token exchange (code → access_token + refresh_token) |
| UserInfo | `GET /api/auth/oauth2/userinfo` | OIDC UserInfo endpoint |
| Introspection | `POST /api/auth/oauth2/introspect` | Token introspection (RFC 7662) |
| Revocation | `POST /api/auth/oauth2/revoke` | Token revocation (RFC 7009) |
| JWKS | `GET /api/auth/jwks` | Public key set for JWT verification |
| Login | `POST /api/auth/login` | Email/password credential verification |
| Logout | `POST /api/auth/logout` | Clear cookies + revoke tokens |
| Callback | `GET /api/auth/callback` | OAuth callback handler |
| Refresh | `POST /api/auth/refresh` | Token refresh endpoint |

---

## 7. Security Principles

1. **PKCE (S256)**: Mandatory for all authorization code flows.
2. **State & Nonce**: CSRF and replay attack prevention.
3. **Cookie Hardening**: `HttpOnly`, `Secure`, `SameSite=Lax` for all auth cookies.
4. **Token Isolation**: No sensitive tokens exposed to client-side JavaScript.
5. **Back-Channel Communication**: Token exchange and refresh are server-to-server.
6. **Zero-Trust Architecture**: Gateway and microservices independently verify JWT signatures via JWKS.
7. **Stateless Core**: Portal API auth is 100% stateless JWT — no Redis session lookup.
8. **jti Blacklist**: Redis-based emergency revocation for immediate token invalidation.
9. **ES256 Asymmetric Signing**: Private key stored in DB, public key exposed via JWKS. No shared secrets.
