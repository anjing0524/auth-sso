# API Specification - Auth-SSO

Version: v1.0
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
- `UNAUTHORIZED`: Invalid or missing session.
- `FORBIDDEN`: Insufficient permissions.
- `NOT_FOUND`: Resource does not exist.
- `INTERNAL_ERROR`: Unexpected server error.

---

## 2. Authentication APIs (Portal)

### 2.1 `GET /api/me`
Retrieve currently logged-in user profile, permissions, and menu list.

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
Initialize login flow. Redirects to IdP.
- **Query Params**: `redirect` (Optional, relative path).

### 2.3 `POST /api/auth/logout`
Log out and invalidate current Portal and IdP sessions.

---

## 3. Administrative APIs (Portal)

Requires `portal_session` and relevant permission codes.

### 3.1 User Management
- `GET /api/admin/users`: List users (Paginated).
- `POST /api/admin/users`: Create a new user.
- `GET /api/admin/users/:id`: Get user details.
- `PUT /api/admin/users/:id`: Update user profile/roles.
- `POST /api/admin/users/:id/reset-password`: Reset password.

### 3.2 Role & Permission Management
- `GET /api/admin/roles`: List roles.
- `POST /api/admin/roles`: Create a role with specific permission IDs.
- `GET /api/admin/permissions`: List all available permission codes.

### 3.3 Client Management
- `GET /api/admin/clients`: List OAuth clients.
- `POST /api/admin/clients`: Register a new OAuth client.
- `POST /api/admin/clients/:id/rotate-secret`: Generate a new client secret.

---

## 4. OIDC Provider APIs (IdP)

Standard OIDC/OAuth 2.1 endpoints.

- `GET /authorize`: Initiate authorization code flow (with PKCE).
- `POST /token`: Exchange authorization code or refresh token for tokens.
- `GET /userinfo`: Retrieve claims about the authenticated user.
- `GET /.well-known/openid-configuration`: Discover OIDC metadata.
- `GET /jwks`: Retrieve JSON Web Key Set for token validation.
