# Database Design - Auth-SSO

Version: v2.0
Status: Released

---

## 1. Storage Architecture

Auth-SSO utilizes a hybrid storage approach with PostgreSQL and Redis. For simplicity, deployment efficiency (especially in Serverless environments), and cross-domain data consistency, all entities reside in a **single physical PostgreSQL database**, while maintaining a strict **logical separation**.

### 1.1 Logical Data Domains
- **Portal Domain**: Contains business logic data such as users, organizational structure, RBAC, and client configurations.
- **Identity & Auth Domain**: Contains authentication credentials, accounts, and session metadata managed by Better Auth.

### 1.2 Redis Keyspaces

| Keyspace Prefix | Purpose | Managed By |
| --- | --- | --- |
| `auth-sso:` | IdP sessions and auth state (Better Auth secondaryStorage) | Better Auth |
| `portal:jti_blocklist:` | JWT jti emergency revocation blacklist | Portal BFF |
| `portal:user_perms:` | User permission context cache (TTL: 300s) | Portal BFF |

---

## 2. Naming Conventions

- **Tables**: Plural snake_case (e.g., `users`, `roles`).
- **Columns**: Snake_case (e.g., `first_name`, `created_at`).
- **Primary Keys**: Internal `id` (text/uuid) for relations, and external `public_id varchar(64)` for API/UI visibility.
- **Foreign Keys**: Reference the internal `id`.
- **Relationship Tables**: Named as `table1_table2_rel`.

---

## 3. Portal Domain Entities

### 3.1 Users (`users`)
- **Primary Key**: `id` (text)
- **External ID**: `public_id varchar(64) unique` (e.g., `u_abc123`)
- **Username**: `username varchar(64) unique`
- **Status**: `ACTIVE`, `DISABLED`, `LOCKED`
- **Audit**: `created_at`, `updated_at`, `deleted_at`

### 3.2 Departments (`departments`)
- **Primary Key**: `id` (text)
- **External ID**: `public_id varchar(64) unique` (e.g., `d_abc123`)
- **Parent**: `parent_id` (self-reference)
- **Hierarchy**: `ancestors varchar(512)` (materialized path)

### 3.3 Roles (`roles`)
- **Primary Key**: `id` (text)
- **External ID**: `public_id varchar(64) unique` (e.g., `r_abc123`)
- **Code**: `code varchar(64) unique` (e.g., `admin`, `editor`)
- **Data Scope**: `ALL`, `DEPT`, `DEPT_AND_SUB`, `SELF`, `CUSTOM`

### 3.4 Permissions (`permissions`)
- **Code**: `code varchar(128) unique` (e.g., `user.create`, `role.assign`)
- **Type**: `MENU`, `API`, `DATA`

### 3.5 OAuth Clients (`clients`)
- **Client ID**: `client_id varchar(128) unique`
- **Secret**: `client_secret_cipher text` (encrypted)
- **Status**: `ACTIVE`, `DISABLED`

---

## 4. Identity & Auth Domain

These tables are managed by Better Auth migrations and share the same database:
- **`user`**: Stores authentication-level user data.
- **`account`**: Links authentication methods (e.g., email/password).
- **`session`**: Better Auth internal session tracking.
- **`oauth_client` / `oauth_access_token` / `oauth_refresh_token`**: OIDC Provider plugin tables.

---

## 5. Redis Key Structures

### 5.1 Portal jti Blacklist (Emergency Revocation)

**Key**: `portal:jti_blocklist:{jti}`
**Value**: `1`
**TTL**: Remaining lifetime of the JWT (token exp - current time), minimum 1 second.
**Purpose**: Enables immediate token invalidation for account bans, password changes, and forced logouts. The TTL auto-expires the key when the token would have naturally expired, preventing unbounded Redis growth.

### 5.2 Portal Permission Context Cache

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
**TTL**: 300 seconds (5 minutes).
**Purpose**: Caches the user's role/permission/data-scope context to avoid repeated DB queries on every API request. Gracefully degrades to direct DB queries on Redis failure.

### 5.3 IdP Session Storage

**Key**: `auth-sso:{sessionToken}` (managed by Better Auth secondaryStorage)
**Purpose**: Better Auth uses Redis as secondary storage for IdP sessions, authorization codes, and other high-performance state. Key prefix is configured via `redisStorage({ keyPrefix: 'auth-sso:' })`.

---

## 6. Implementation Notes

1. **Logical Deletion**: Primary business tables use `deleted_at` for soft deletes.
2. **Indexing**: Indexes are placed on `username`, `client_id`, `public_id`, and foreign key columns (`dept_id`, `user_id`).
3. **Partial Unique Indexes**: Used for nullable fields that must be unique when present (e.g., `email`, `mobile`).
4. **Shared Database (v1.0)**: Both Portal and IdP domains share the same PostgreSQL instance for deployment simplicity. The IdP authorization endpoint queries Portal domain tables (`roles`, `roleClients`) directly. This coupling is acknowledged and acceptable for v1.0.
