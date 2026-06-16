# Project Plan & Milestones - Auth-SSO

Version: v2.0
Status: Released

---

## 1. Project Objectives

- Implement a functional IAM system with SSO and RBAC.
- Ensure security and stability for v1.0 release.
- Achieve 100% automated test coverage for critical paths.
- Deliver comprehensive documentation for deployment and integration.

---

## 2. Milestones

| Milestone | Name | Status | Objectives |
| --- | --- | --- | --- |
| **M0** | Solution Definition | ✅ | Finalize architecture, PRD, and tech selection. |
| **M1** | Infrastructure Base | ✅ | Initialize apps, configure DB/Redis, setup monorepo. |
| **M2** | Core Authentication | ✅ | Build login/callback flow, establish Portal-IdP link. |
| **M3** | Session Resilience | ✅ | Implement JWT Cookie lifecycle, token refresh, and global logout. |
| **M4** | Permission Center | ✅ | Complete management UI/APIs for Users/Roles/Clients. |
| **M5** | SSO Integration | ✅ | Verify SSO flow, publish guide. |
| **M6** | Quality & Launch | ✅ | Security hardening, E2E testing, deployment SOP. |
| **M7** | API Gateway | ✅ | Rust/Pingora gateway with ES256 JWKS offline verification. |

---

## 3. System Components

### 3.1 IdP (Better Auth)
- [x] Better Auth configuration & OIDC Provider plugins.
- [x] Authorization server implementation (with RBAC pre-check).
- [x] Login & Consent pages.
- [x] Client/User mapping.
- [x] Global SSO Logout endpoint.

### 3.2 Portal BFF
- [x] OIDC Client integration (Authorization Code + PKCE).
- [x] Stateless JWT Cookie management (`portal_jwt_token` + `portal_refresh_token`).
- [x] jti blacklist for emergency token revocation.
- [x] RBAC API handlers with data scope filtering.
- [x] Audit logging subsystem.
- [x] Next.js middleware for page-level route protection.

### 3.3 API Gateway (Rust/Pingora)
- [x] Unified HTTPS entry point with SNI routing.
- [x] ES256 JWKS offline JWT verification (zero network I/O).
- [x] Cookie-to-Bearer transformation (strip Cookie, inject Authorization header).
- [x] Background JWKS key refresh (5-minute interval).

### 3.4 Management Portal (UI)
- [x] User management screens.
- [x] Role & Permission configuration.
- [x] App (Client) registration UI.
- [x] Audit log viewer.

### 3.5 Demo App
- [x] Standard OIDC Client integration.
- [x] SSO cross-app login/logout verification.

---

## 4. Testing & Quality Assurance

### 4.1 Automated Tests
- **Smoke Tests**: Basic availability.
- **Authentication**: Login/callback/logout, PKCE, state, nonce.
- **SSO**: Multi-app login scenarios.
- **Security**: Token isolation, Cookie hardening, jti revocation.
- **RBAC**: Permission checks, data scopes.

### 4.2 Quality Metrics
- Critical flows: 100% pass rate.
- Automated tests: 60+ test cases covering all M2-M7 requirements.

---

## 5. Deployment Roadmap

1. **Staging**: Internal verification with demo app.
2. **Production**: Phased rollout with Gateway as unified entry point.
3. **Operations**: Monitor Redis (jti blocklist, permission cache), Gateway JWKS refresh, and audit logs.
