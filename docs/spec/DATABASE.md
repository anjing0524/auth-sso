# Database Design - Auth-SSO

Version: v3.0
Status: Released
Last Updated: 2026-06-18

---

## 1. Storage Architecture

Auth-SSO utilizes a hybrid storage approach with PostgreSQL and Redis. For simplicity, deployment efficiency, and data consistency, all entities reside in a **single physical PostgreSQL database**, while maintaining a strict **logical separation**.

### 1.1 Logical Data Domains
- **Portal Core Domain**: Contains business logic data such as users, organizational structure (departments), menus, audit logs, and RBAC (roles, permissions).
- **OIDC Provider Domain**: Contains OIDC client configurations, authorization codes, active tokens, consents, and cryptographic key pairs (JWKS).

### 1.2 Redis Keyspaces

| Keyspace Prefix | Purpose | TTL | Managed By |
| --- | --- | --- | --- |
| `portal:jti_blocklist:` | JWT jti emergency revocation blacklist | Token 剩余有效期 | Portal BFF |
| `portal:user_perms:` | User permission context cache | 3600s (与 Access Token TTL 对齐) | Portal BFF |

---

## 2. Naming Conventions

- **Tables**: Plural snake_case (e.g., `users`, `roles`).
- **Columns**: Snake_case (e.g., `dept_id`, `created_at`).
- **Primary Keys**: Internal `id` (text/uuid) for relations, external `public_id` (text) for API/UI visibility.
- **Foreign Keys**: Reference the internal `id` by default. Exception: `permissions.clientId` and `roleClients.clientId` reference `clients.clientId` (business key) — see §3.4 for rationale.
- **Status**: All entities use enum-backed status columns. Users use `user_status` enum (`ACTIVE`, `DISABLED`, `LOCKED`, `DELETED`). All other entities use `entity_status` enum (`ACTIVE`, `DISABLED`). Soft-delete for users is implemented via `status = 'DELETED'`.

---

## 3. Portal Domain Entities

### 3.1 Users (`users`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | Internal UUID |
| `public_id` | text | UNIQUE, NOT NULL | External public ID (e.g., `user_abc123`) |
| `username` | text | UNIQUE, NOT NULL | Login username |
| `email` | text | UNIQUE | Email address |
| `email_verified` | boolean | DEFAULT false | Email verification flag |
| `mobile` | text | UNIQUE | Mobile phone number |
| `mobile_verified` | boolean | DEFAULT false | Mobile verification flag |
| `password_hash` | text | | Hashed password |
| `name` | text | NOT NULL | Display name |
| `avatar_url` | text | | Avatar image URL |
| `status` | user_status | NOT NULL, DEFAULT 'ACTIVE' | `ACTIVE` / `DISABLED` / `LOCKED` / `DELETED` |
| `dept_id` | text | FK → departments.id, ON DELETE SET NULL | Department assignment |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | Auto-updated |
| `last_login_at` | timestamp | | Last successful login time |

**Indexes**:
- Partial index on `status` WHERE `status <> 'DELETED'` (covers list queries)
- Index on `dept_id`

**Relations**:
- `userRoles` → many `user_roles`
- `department` → one `departments` (via `dept_id`)

### 3.2 Departments (`departments`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | Internal UUID |
| `public_id` | text | UNIQUE, NOT NULL | External public ID (e.g., `dept_abc123`) |
| `parent_id` | text | | Self-reference for tree hierarchy |
| `name` | text | NOT NULL | Department name |
| `code` | text | | Business code |
| `ancestors` | text | | Materialized path (e.g., `dept_001/dept_002`), NULL for root. Enables efficient subtree queries without recursive CTE |
| `sort` | integer | DEFAULT 0 | Display order |
| `status` | entity_status | NOT NULL, DEFAULT 'ACTIVE' | |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | Auto-updated |

**Indexes**:
- Index on `parent_id`
- Index on `ancestors`

**Subtree query via ancestors**:
```sql
-- 查询 deptId 及其所有子部门
SELECT id FROM departments
WHERE id = :deptId OR ancestors LIKE :deptId || '/%'
```

### 3.3 Roles (`roles`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | Internal UUID |
| `public_id` | text | UNIQUE, NOT NULL | External public ID (e.g., `role_abc123`) |
| `name` | text | NOT NULL | Role display name |
| `code` | text | UNIQUE, NOT NULL | Role code (e.g., `admin`, `editor`) |
| `description` | text | | |
| `data_scope_type` | data_scope_type | NOT NULL, DEFAULT 'SELF' | `ALL` / `DEPT` / `DEPT_AND_SUB` / `SELF` / `CUSTOM` |
| `is_system` | boolean | DEFAULT false | System roles cannot be deleted |
| `status` | entity_status | NOT NULL, DEFAULT 'ACTIVE' | |
| `sort` | integer | DEFAULT 0 | |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | Auto-updated |

### 3.4 Permissions (`permissions`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | Internal UUID |
| `public_id` | text | UNIQUE, NOT NULL | External public ID (e.g., `perm_abc123`) |
| `name` | text | NOT NULL | Permission display name |
| `code` | text | UNIQUE, NOT NULL | Permission code (e.g., `user.create`) |
| `type` | permission_type | NOT NULL, DEFAULT 'API' | `MENU` / `API` / `DATA` |
| `resource` | text | | Resource path (API permissions) |
| `action` | text | | Action (API permissions) |
| `parent_id` | text | | Self-reference for tree hierarchy |
| `client_id` | text | FK → clients.client_id | **References business client_id, NOT clients.id**. See rationale below |
| `status` | entity_status | NOT NULL, DEFAULT 'ACTIVE' | |
| `sort` | integer | DEFAULT 0 | |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | Auto-updated |

**Indexes**:
- Index on `client_id`
- Index on `parent_id`

> **Why `client_id` references `clients.clientId` (business key) instead of `clients.id`?**
>
> The Gateway (Rust/Pingora) and the permission registration endpoint consume `permissions.clientId` directly
> and expect the business `client_id` value. Since `clients.client_id` has a UNIQUE constraint, referential
> integrity is equivalent to referencing the internal `id`. This is the only intentional FK exception —
> all other FKs reference the internal `id`.

### 3.5 Menus (`menus`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | Internal UUID |
| `public_id` | text | UNIQUE, NOT NULL | External public ID (e.g., `menu_abc123`) |
| `parent_id` | text | | Self-reference for tree hierarchy |
| `name` | text | NOT NULL | Menu display name |
| `path` | text | | Frontend route path |
| `permission_code` | text | | Permission code required to access |
| `icon` | text | | Icon name |
| `component` | text | | Frontend component path |
| `visible` | boolean | DEFAULT true | |
| `sort` | integer | DEFAULT 0 | |
| `menu_type` | menu_type | NOT NULL, DEFAULT 'MENU' | `DIRECTORY` / `MENU` / `BUTTON` |
| `status` | entity_status | NOT NULL, DEFAULT 'ACTIVE' | |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | Auto-updated |

### 3.6 User-Role Association (`user_roles`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `user_id` | text | FK → users.id, ON DELETE CASCADE | |
| `role_id` | text | FK → roles.id, ON DELETE CASCADE | |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |

**Unique Index**: `(user_id, role_id)` — prevents duplicate role assignment.

### 3.7 Role-Permission Association (`role_permissions`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `role_id` | text | FK → roles.id, ON DELETE CASCADE | |
| `permission_id` | text | FK → permissions.id, ON DELETE CASCADE | |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |

**Unique Index**: `(role_id, permission_id)` — prevents duplicate binding.

### 3.8 Role-DataScope Association (`role_data_scopes`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `role_id` | text | FK → roles.id, ON DELETE CASCADE | |
| `dept_id` | text | FK → departments.id, ON DELETE CASCADE | |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |

**Unique Index**: `(role_id, dept_id)` — prevents duplicate department scope binding.

### 3.9 Role-Client Association (`role_clients`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `role_id` | text | FK → roles.id, ON DELETE CASCADE | |
| `client_id` | text | FK → clients.client_id, ON DELETE CASCADE | **References business client_id** (same rationale as §3.4) |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |

**Unique Index**: `(role_id, client_id)` — prevents duplicate client binding.

---

## 4. OIDC Provider Domain Entities

### 4.1 OAuth Clients (`clients`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | Internal UUID |
| `public_id` | text | UNIQUE, NOT NULL | External public ID (e.g., `cli_abc123`) |
| `name` | text | NOT NULL | Client application name |
| `client_id` | text | UNIQUE, NOT NULL | OAuth 2.1 client identifier |
| `client_secret` | text | | OAuth 2.1 client secret (nullable for public clients) |
| `redirect_uris` | text[] | NOT NULL | Allowed redirect URIs (PostgreSQL native text array) |
| `scopes` | text | NOT NULL, DEFAULT 'openid profile email offline_access' | Space-separated OAuth scopes (RFC 6749 compliant) |
| `homepage_url` | text | | Client homepage |
| `logo_url` | text | | Client logo image URL |
| `access_token_ttl` | integer | DEFAULT 3600 | Access Token lifetime in seconds |
| `refresh_token_ttl` | integer | DEFAULT 604800 | Refresh Token lifetime in seconds |
| `status` | entity_status | NOT NULL, DEFAULT 'ACTIVE' | |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | Auto-updated |

### 4.2 Authorization Codes (`authorization_codes`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `code` | text | UNIQUE, NOT NULL | The authorization code |
| `client_id` | text | FK → clients.id, ON DELETE CASCADE | |
| `user_id` | text | FK → users.id, ON DELETE CASCADE | Resource owner |
| `redirect_uri` | text | NOT NULL | Exact redirect URI used in the request |
| `scope` | text | NOT NULL | Requested scopes |
| `state` | text | | OAuth state parameter |
| `nonce` | text | | OIDC nonce parameter |
| `code_challenge` | text | | PKCE code challenge (RFC 7636) |
| `code_challenge_method` | code_challenge_method | DEFAULT 'S256' | PKCE challenge method |
| `expires_at` | timestamp | NOT NULL | Absolute expiration time |
| `used` | boolean | DEFAULT false | Single-use enforcement |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |

### 4.3 Access Tokens (`access_tokens`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `token` | text | UNIQUE | Token value hash (for introspection/revocation) |
| `client_id` | text | FK → clients.id, ON DELETE CASCADE | |
| `user_id` | text | FK → users.id, ON DELETE CASCADE | |
| `scopes` | text | NOT NULL | Granted scopes |
| `expires_at` | timestamp | | |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | Auto-updated |

### 4.4 Refresh Tokens (`refresh_tokens`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `token` | text | UNIQUE | Token value hash |
| `client_id` | text | FK → clients.id, ON DELETE CASCADE | |
| `user_id` | text | FK → users.id, ON DELETE CASCADE | |
| `scopes` | text | NOT NULL | |
| `revoked` | timestamp | | Non-null if revoked |
| `auth_time` | timestamp | | Original authentication time |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | Auto-updated |
| `expires_at` | timestamp | | |

### 4.5 Consents (`consents`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `user_id` | text | FK → users.id, ON DELETE CASCADE | |
| `client_id` | text | FK → clients.id, ON DELETE CASCADE | |
| `scopes` | text | NOT NULL | User-consented scopes |
| `consent_given` | boolean | | Explicit consent flag |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `updated_at` | timestamp | DEFAULT now() | Auto-updated |

**Index**: `(user_id, client_id)` — composite index for consent lookup.

### 4.6 JWKS Keys (`jwks`)

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `kid` | text | UNIQUE | Key ID (matches JWT header `kid`). Falls back to `id` for legacy records where this is null |
| `algorithm` | jwk_algorithm | DEFAULT 'ES256' | Signing algorithm |
| `public_key` | text | NOT NULL | Public key (JWK format) |
| `private_key` | text | NOT NULL | Private key (JWK format) |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |
| `expires_at` | timestamp | | Key rotation expiry |

---

## 5. Audit & Log Tables

### 5.1 Audit Logs (`audit_logs`)

Append-only operation audit trail. **No FK constraints** — logs must survive entity deletion.

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `user_id` | text | | Actor user ID (no FK, survives user deletion) |
| `username` | text | | Actor username (redundant copy for log self-containment) |
| `operation` | text | NOT NULL | Audit operation type |
| `method` | text | | HTTP method |
| `url` | text | | Request URL |
| `params` | jsonb | | Structured request parameters (PostgreSQL JSONB) |
| `ip` | text | | Client IP address |
| `user_agent` | text | | |
| `status` | integer | | HTTP response status |
| `duration` | integer | | Request duration in ms |
| `error_msg` | text | | Error message if failed |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |

### 5.2 Login Logs (`login_logs`)

Append-only login event trail. **No FK constraints** — same rationale as audit logs.

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | text | PK | |
| `user_id` | text | | Actor user ID (no FK) |
| `username` | text | NOT NULL | Actor username (redundant copy) |
| `event_type` | text | NOT NULL | `LOGIN_SUCCESS` / `LOGIN_FAILED` / `LOGOUT` / `TOKEN_REFRESH` / `TOKEN_REFRESH_FAILED` |
| `ip` | text | | |
| `user_agent` | text | | |
| `location` | text | | Geo-location (if available) |
| `fail_reason` | text | | Reason for failed login |
| `created_at` | timestamp | NOT NULL, DEFAULT now() | |

---

## 6. PostgreSQL Enum Definitions

| Enum Name | Values | Used By |
|-----------|--------|---------|
| `user_status` | `ACTIVE`, `DISABLED`, `LOCKED`, `DELETED` | users.status |
| `entity_status` | `ACTIVE`, `DISABLED` | roles, permissions, departments, menus, clients |
| `data_scope_type` | `ALL`, `DEPT`, `DEPT_AND_SUB`, `SELF`, `CUSTOM` | roles.data_scope_type |
| `permission_type` | `MENU`, `API`, `DATA` | permissions.type |
| `menu_type` | `DIRECTORY`, `MENU`, `BUTTON` | menus.menu_type |
| `jwk_algorithm` | `ES256` | jwks.algorithm |
| `code_challenge_method` | `S256` | authorization_codes.code_challenge_method |

All enum values are defined as the single source of truth in `@auth-sso/contracts` and re-exported via `apps/portal/src/db/schema/enums.ts`.

---

## 7. Foreign Key Summary

| Source Table | Source Column | Target Table | Target Column | On Delete |
|-------------|---------------|--------------|---------------|-----------|
| `users` | `dept_id` | `departments` | `id` | SET NULL |
| `user_roles` | `user_id` | `users` | `id` | CASCADE |
| `user_roles` | `role_id` | `roles` | `id` | CASCADE |
| `role_permissions` | `role_id` | `roles` | `id` | CASCADE |
| `role_permissions` | `permission_id` | `permissions` | `id` | CASCADE |
| `role_data_scopes` | `role_id` | `roles` | `id` | CASCADE |
| `role_data_scopes` | `dept_id` | `departments` | `id` | CASCADE |
| `role_clients` | `role_id` | `roles` | `id` | CASCADE |
| `role_clients` | `client_id` | `clients` | `client_id` * | CASCADE |
| `permissions` | `client_id` | `clients` | `client_id` * | CASCADE |
| `authorization_codes` | `client_id` | `clients` | `id` | CASCADE |
| `authorization_codes` | `user_id` | `users` | `id` | CASCADE |
| `access_tokens` | `client_id` | `clients` | `id` | CASCADE |
| `access_tokens` | `user_id` | `users` | `id` | CASCADE |
| `refresh_tokens` | `client_id` | `clients` | `id` | CASCADE |
| `refresh_tokens` | `user_id` | `users` | `id` | CASCADE |
| `consents` | `user_id` | `users` | `id` | CASCADE |
| `consents` | `client_id` | `clients` | `id` | CASCADE |

> \* `role_clients.client_id` and `permissions.client_id` reference `clients.client_id` (business key) instead of `clients.id`. This is intentional — the Gateway and permission registration endpoint consume the business `client_id` directly. `clients.client_id` has a UNIQUE constraint, so referential integrity is equivalent.

---

## 8. Redis Key Structures

### 8.1 Portal jti Blacklist (Emergency Revocation)

**Key**: `portal:jti_blocklist:{jti}`
**Value**: `1`
**TTL**: Remaining lifetime of the JWT (token exp - current time), minimum 1 second.
**Purpose**: Enables immediate token invalidation for account bans, password changes, and forced logouts. The TTL auto-expires the key when the token would have naturally expired, preventing unbounded Redis growth.

### 8.2 Portal Permission Context Cache

**Key**: `portal:user_perms:{userId}`
**Value** (JSON):
```json
{
  "roles": [
    { "id": "role_1", "code": "admin", "name": "Administrator" }
  ],
  "permissions": ["user:list", "user:create", "role:assign"],
  "dataScopeType": "ALL",
  "deptId": "dept_001"
}
```
**TTL**: 3600 seconds (aligned with Access Token TTL).
**Purpose**: Caches the user's role/permission/data-scope context to avoid repeated DB queries on every API request. Actively pre-populated at token issuance (`cacheUserPermissionContext`). Gracefully degrades to direct DB queries on Redis failure.

---

## 9. Implementation Notes

1. **Soft Delete**: Users use `status = 'DELETED'`. All other entities use `status = 'DISABLED'` (hard delete not implemented — status-driven lifecycle).
2. **Indexing**: Indexes on `username`, `client_id`, `public_id`, foreign key columns, and `created_at` for audit tables. Partial indexes for filtered queries (e.g., active users).
3. **Tree Structures**: Departments, menus, and permissions use self-referencing `parent_id`. Departments additionally use an `ancestors` materialized path for efficient subtree queries without recursive CTE.
4. **Drizzle Relations**: Declared in `apps/portal/src/db/schema/relations.ts`. Enables `db.query.table.findMany({ with: {...} })` for nested object hydration. Complex reporting queries still use manual joins.
5. **ID Strategy**: All entities have both `id` (internal UUID) and `public_id` (external, prefixed). External APIs accept either; internal lookups use the `byIdOrPublicId()` helper.
6. **Shared Database**: Both Portal Core and OIDC Provider domains share the same physical database for simplicity and referential integrity.
