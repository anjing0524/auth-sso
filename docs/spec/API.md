# API Specification - Auth-SSO

Version: v2.0
Status: Released

---

## 1. Global Conventions

### 1.1 Base URL
- **Portal API**: `https://portal.example.com/api`
- **IdP OIDC API**: `https://idp.example.com`

### 1.2 Common Response
**Success (200 OK)**:
```json
{
  "code": "OK",
  "message": "success",
  "data": {}
}
```

**Error (4xx/5xx)**:
```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable error message",
  "requestId": "req_abc123"
}
```

### 1.3 Common Error Codes
- `BAD_REQUEST`: Parameter validation failure.
- `UNAUTHORIZED`: Invalid or missing JWT Cookie.
- `FORBIDDEN`: Insufficient permissions.
- `NOT_FOUND`: Resource does not exist.
- `INTERNAL_ERROR`: Unexpected server error.

### 1.4 ID Convention
- **Public IDs**: All IDs exposed in the API (path parameters, request bodies, responses) are strings (`public_id`), e.g., `u_abc123`.
- **Internal IDs**: Database primary keys also use strings (UUIDs) for consistency across environments.
- **Opacity**: Frontend and external consumers never interact with internal database primary keys.

### 1.5 Authentication Convention
All administrative API endpoints require a valid `portal_jwt_token` HttpOnly Cookie. This Cookie is set by the Portal BFF during the OAuth callback flow. The JWT contains user identity, roles, permissions, and data scope claims. Detailed permission verification is performed by the `withPermission()` wrapper in each API route handler.

---

## 2. Authentication APIs (Portal)

### 2.1 `GET /api/me`
Retrieve currently logged-in user profile, permissions, and menu list.

**Authentication**: Requires `portal_jwt_token` HttpOnly Cookie.

**Success Data**:
```json
{
  "authenticated": true,
  "user": {
    "id": "u_1",
    "name": "John Doe",
    "permissions": ["user.read", "role.assign"]
  },
  "menus": [
    { "name": "User Management", "path": "/admin/users" }
  ]
}
```

### 2.2 `GET /api/auth/login`
Initialize login flow. Generates PKCE parameters (code_verifier, code_challenge, state, nonce), stores them in HttpOnly Cookies, and redirects to IdP `/authorize` endpoint.
- **Query Params**: `redirect` (Optional, relative path).

### 2.3 `POST /api/auth/logout`
Log out and invalidate current session:
1. Decodes the current `portal_jwt_token` and adds its `jti` to the Redis blacklist (immediate revocation).
2. Revokes the Refresh Token at the IdP `/oauth2/revoke` endpoint.
3. Clears both `portal_jwt_token` and `portal_refresh_token` Cookies.

### 2.4 `POST /api/auth/refresh`
Silently refreshes the `portal_jwt_token` HttpOnly Cookie using the `portal_refresh_token`.

**Request**:
- Header: Cookie containing `portal_refresh_token` (Path=/api/auth/refresh).

**Success Data (200 OK)**:
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "expiresAt": 1718080000
  }
}
```
Set-Cookie header will contain a new `portal_jwt_token`.

---

## 3. Administrative APIs (Portal)

Requires `portal_jwt_token` HttpOnly Cookie and relevant permission codes. All routes are protected by the `withPermission()` middleware wrapper.

### 3.1 User Management
- `GET /api/users`: List users (Paginated).
  - **Query Params**: `page`, `pageSize`, `search`, `deptId`.
  - **Data Scope**: Results are automatically filtered by the current user's data scope (ALL, DEPT, etc.).
- `POST /api/users`: Create a new user.
- `GET /api/users/:id`: Get user details.
- `PUT /api/users/:id`: Update user profile/roles.
- `POST /api/users/:id/reset-password`: Reset password.

### 3.2 Department Management
- `GET /api/departments`: List departments (Tree structure).
- `POST /api/departments`: Create a new department.
- `GET /api/departments/:id`: Get department details.

### 3.3 Role & Permission Management
- `GET /api/roles`: List roles.
- `POST /api/roles`: Create a role with specific permission IDs and data scope.
- `GET /api/permissions`: List all available permission codes.
- `GET /api/roles/:id/permissions`: Get permissions assigned to a role.

### 3.4 Client Management
- `GET /api/clients`: List OAuth clients.
- `POST /api/clients`: Register a new OAuth client.
- `POST /api/clients/:id/rotate-secret`: Generate a new client secret.

---

## 4. OIDC Provider APIs (IdP)

Standard OIDC/OAuth 2.1 endpoints. **All endpoints below are provided by Better Auth's built-in OIDC Provider plugin** via the catch-all route (`/api/auth/[...all]`), except where noted as custom.

| Endpoint | Path | Provided By |
|---|---|---|
| Authorization | `GET /api/auth/oauth2/authorize` | Custom handler (RBAC pre-check) + Better Auth |
| Token Exchange | `POST /api/auth/oauth2/token` | Better Auth built-in |
| Token Revocation | `POST /api/auth/oauth2/revoke` | Better Auth built-in |
| Token Introspection | `POST /api/auth/oauth2/introspect` | Better Auth built-in |
| UserInfo | `GET /api/auth/oauth2/userinfo` | Better Auth built-in |
| JWKS | `GET /api/auth/jwks` | Better Auth JWT plugin |
| Discovery | `GET /api/auth/.well-known/openid-configuration` | Better Auth built-in |
| Global SSO Logout | `POST /api/auth/sign-out-sso` | Custom handler |
