# System Architecture - Auth-SSO

Version: v1.0
Status: Released

---

## 1. System Overview

Auth-SSO is a unified identity and access management (IAM) system built on top of `Next.js` and `Better Auth`. It consists of two primary applications and a set of shared libraries.

- **`apps/portal` (Portal)**: The user-facing management console and BFF (Backend for Frontend). It manages business logic, organizational structure, and RBAC with granular data scope filtering.
- **`apps/idp` (IdP)**: The identity provider, implemented using Better Auth. It handles authentication, OIDC flows, and IdP session management.
- **`apps/customer-graph` (Graph)**: A GPU-accelerated visualization service (Next.js + WASM) for demonstrating RBAC data scope relationships.
- **`wasm-engine` (WASM)**: A Rust-based high-performance engine for relationship calculations.

---

## 2. Technical Stack

- **Framework**: Next.js 16 (App Router, Turbopack).
- **Identity Engine**: [Better Auth](https://better-auth.com/) (Email/Password, OAuth 2.1 Provider).
- **Database**: PostgreSQL 16+.
- **ORM**: Drizzle ORM.
- **Session Cache**: Redis (for both Portal and IdP sessions).
- **Compute**: WebAssembly (WASM) / Rust for high-performance graph processing.
- **Styling**: Tailwind CSS 4, shadcn/ui.
- **Language**: TypeScript.

---

## 3. High-Level Architecture

```text
Browser
  -> Portal (BFF)
       -> Redis (Portal Sessions)
       -> PostgreSQL (Portal Core Domain)
  -> IdP (Better Auth)
       -> Redis (IdP Sessions)
       -> PostgreSQL (Auth Domain)
  -> Customer Graph (Visualization)
       -> WASM Engine (Relationship Logic)
  -> Sub-Applications (OIDC Clients)
       -> IdP (Authorize/Token)
```

### 3.1 Responsibilities
- **Portal**:
  - Act as an OIDC client for IdP.
  - Manage Users, Departments, Roles, and Permissions.
  - Implement RBAC with Data Scope (ALL, DEPT, DEPT_AND_SUB, SELF, CUSTOM).
  - Maintain the "Portal Session" (portal_session cookie).
- **IdP**:
  - Act as the central OIDC Provider.
  - Provide Login, Authorization, and Token endpoints.
  - Maintain the "IdP Session" (idp_session cookie) for SSO.
- **Database**:
  - **Shared Database**: For performance and deployment simplicity, all domains share a single PostgreSQL database.
  - **Portal Domain**: Business-level RBAC and organizational data.
  - **Auth Domain**: Better Auth internal persistence (users, accounts, refresh tokens).
- **WASM Engine**:
  - Perform complex graph traversal and relationship filtering in the browser.
  - Offload heavy compute from the main thread.

---

## 4. Authentication & SSO Flows

### 4.1 Portal Login Flow
1. User accesses Portal.
2. Portal redirects user to IdP `/authorize` endpoint.
3. User logs in at IdP (using email/password).
4. IdP redirects back to Portal `/callback` with an authorization `code`.
5. Portal exchanges `code` for `id_token` and `access_token` via IdP `/token`.
6. Portal establishes a **Portal Session** in Redis.
7. Portal returns a `portal_session` cookie to the browser.

### 4.2 Single Sign-On (SSO) Flow
1. User accesses a Sub-Application (e.g., `apps/demo-app`).
2. Sub-app redirects to IdP `/authorize`.
3. Browser automatically sends the `idp_session` cookie.
4. IdP recognizes the session and redirects back to Sub-app with a `code` (skipping the login UI).
5. Sub-app exchanges `code` for tokens and establishes its own session.

---

## 5. Session Management

### 5.1 Dual-Session Model
- **Portal Session**: Represents the user's login state for the management portal.
- **IdP Session**: Represents the user's global login state across all SSO-integrated applications.

### 5.2 Timeout Strategies
- **Idle Timeout**: Session expires after a period of inactivity (e.g., 30 mins).
- **Absolute Timeout**: Session must be re-authenticated after a fixed period (e.g., 8 hours).
- **Refresh Token**: Used by the Portal BFF to keep the `access_token` alive without user interaction, up until the Portal Session expires.

---

## 6. Better Auth Integration

The IdP application (`apps/idp`) uses Better Auth with the following plugins:
- **Core Auth**: Basic user management and authentication.
- **Email & Password**: Primary credential provider.
- **OAuth 2.1 Provider**: Implements OIDC/OAuth 2.1 endpoints.
- **JWT**: For signing ID Tokens and providing JWKS.

### 6.1 IdP-Portal Linking
- When a user is created in the Portal, a corresponding identity record is created in the IdP.
- The `sub` (subject) claim in OIDC tokens is used to link the IdP identity to the business user in the `portal_core` database.

---

## 7. Security Principles

1. **PKCE (Proof Key for Code Exchange)**: Mandatory for all authorization code flows.
2. **State & Nonce**: Used to prevent CSRF and replay attacks.
3. **Cookie Hardening**: `HttpOnly`, `Secure`, `SameSite=Lax`.
4. **Token Isolation**: No sensitive tokens (Access/Refresh) are exposed to the client-side JavaScript.
5. **Back-Channel Communication**: Token exchange and refresh occur server-to-server.
6. **Global Logout**: Logging out from the Portal also invalidates the IdP session, ensuring subsequent SSO attempts require re-authentication.
