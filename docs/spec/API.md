# API Specification - Auth-SSO

Version: v3.0
Status: Released

---

## 1. Global Conventions

### 1.1 Base URL
- **Portal API (含 OIDC Provider)**: `https://portal.example.com/api`

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

### 2.2 `POST /api/auth/login`
Initialize login flow. Validates credentials, issues a temporary `login_session` JWT (5-minute TTL, ES256), and sets it as an HttpOnly Cookie for the authorize endpoint.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "user_password"
}
```

**Success Response (200 OK)**:
```json
{
  "success": true
}
```
Set-Cookie header will contain `login_session` (path=/api/auth/oauth2/authorize).

### 2.3 `POST /api/auth/logout`
Log out and invalidate current session:
1. Decodes the current `portal_jwt_token` and adds its `jti` to the Redis blacklist (immediate revocation).
2. Clears the `portal_jwt_token` Cookie.

**Success Response (200 OK)**:
```json
{
  "success": true
}
```
Set-Cookie header will clear `portal_jwt_token` (maxAge=0).

### 2.4 `POST /api/auth/refresh`
Silently refreshes the `portal_jwt_token` HttpOnly Cookie using the `portal_refresh_token` Cookie (Refresh Token Rotation).

**Request**:
- Cookie containing `portal_refresh_token` (Path=/api/auth/refresh).

**Success Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "expiresIn": 3600
  }
}
```
Set-Cookie header will contain updated `portal_jwt_token` and `portal_refresh_token`.

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

## 4. OIDC Provider APIs (内建于 Portal)

Standard OAuth 2.1 and OIDC endpoints, custom implemented as Next.js Route Handlers:

| Endpoint | Path | Method | Description |
|---|---|---|---|
| OpenID Discovery | `/.well-known/openid-configuration` | GET | Returns OpenID Connect Provider metadata |
| Authorization | `/api/auth/oauth2/authorize` | GET | Implements Authorization Code + PKCE authorization flow |
| Token Exchange | `/api/auth/oauth2/token` | POST | Exchanges code for access_token + refresh_token, or performs refresh rotation |
| UserInfo | `/api/auth/oauth2/userinfo` | GET | Returns claims about the authenticated user |
| Introspection | `/api/auth/oauth2/introspect` | POST | Decodes and validates active tokens (RFC 7662) |
| Revocation | `/api/auth/oauth2/revoke` | POST | Revokes active access or refresh tokens (RFC 7009) |
| JWKS | `/api/auth/jwks` | GET | Exposes public key set (JWK format) for signature verification |
| Auth Callback | `/api/auth/callback` | GET | Backend callback handler that exchanges auth code and sets cookies |
