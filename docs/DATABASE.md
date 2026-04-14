# Database Design - Auth-SSO

Version: v1.0
Status: Released

---

## 1. Storage Architecture

Auth-SSO utilizes a hybrid storage approach with PostgreSQL and Redis.

### 1.1 PostgreSQL Schemas
- **`portal_core`**: Contains business logic data such as users, organizational structure, RBAC, and client configurations.
- **`idp_auth`**: Contains identity provider data managed by Better Auth, including authentication credentials, accounts, and session metadata.

### 1.2 Redis Keyspaces
- **`portal:*`**: Stores active Portal sessions and temporary authentication transaction contexts.
- **`idp:*`**: Stores active IdP sessions for cross-application SSO.

---

## 2. Naming Conventions

- **Tables**: Plural snake_case (e.g., `users`, `roles`).
- **Columns**: Snake_case (e.g., `first_name`, `created_at`).
- **Primary Keys**: Internal `id bigint` (identity) for relations, and external `public_id varchar(64)` for API/UI visibility.
- **Foreign Keys**: Reference the internal `id`.
- **Relationship Tables**: Named as `table1_table2_rel`.

---

## 3. Core Entities (portal_core)

### 3.1 Users (`users`)
- **Primary Key**: `id bigint`
- **External ID**: `public_id varchar(64) unique` (e.g., `u_abc123`)
- **Username**: `username varchar(64) unique`
- **Status**: `ACTIVE`, `DISABLED`, `LOCKED`
- **Audit**: `created_at`, `updated_at`, `deleted_at`

### 3.2 Departments (`departments`)
- **Primary Key**: `id bigint`
- **External ID**: `public_id varchar(64) unique` (e.g., `d_abc123`)
- **Parent**: `parent_id bigint` (self-reference)
- **Hierarchy**: `ancestors varchar(512)` (materialized path)

### 3.3 Roles (`roles`)
- **Primary Key**: `id bigint`
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

## 4. Better Auth (idp_auth)

These tables are managed by Better Auth migrations:
- **`user`**: Stores authentication-level user data.
- **`account`**: Links authentication methods (e.g., email/password).
- **`session`**: Better Auth internal session tracking.
- **`oauth_client` / `oauth_access_token` / `oauth_refresh_token`**: OIDC Provider plugin tables.

---

## 5. Redis Key Structures

### 5.1 Portal Session
**Key**: `portal:sess:{sessionId}`
**Value (JSON)**:
```json
{
  "sessionId": "sess_123",
  "userId": "u_1",
  "accessToken": "...",
  "refreshToken": "...",
  "absoluteExpiresAt": "ISO-TIMESTAMP",
  "lastAccessAt": "ISO-TIMESTAMP"
}
```

### 5.2 IdP Session
**Key**: `idp:sess:{sessionId}`
**Value (JSON)**:
```json
{
  "sessionId": "idp_123",
  "userId": "u_1",
  "subject": "sub_123",
  "expiresAt": "ISO-TIMESTAMP"
}
```

---

## 6. Implementation Notes

1. **Logical Deletion**: Primary business tables use `deleted_at` for soft deletes.
2. **Indexing**: Indexes are placed on `username`, `client_id`, `public_id`, and foreign key columns (`dept_id`, `user_id`).
3. **Partial Unique Indexes**: Used for nullable fields that must be unique when present (e.g., `email`, `mobile`).
