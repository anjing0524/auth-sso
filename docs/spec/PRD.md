# Product Requirements Document (PRD) - Auth-SSO

Version: v1.1
Status: Released
Last Updated: 2026-06-24
Target Audience: Product, Engineering, QA, Operations

---

## 1. Executive Summary

This document defines the requirements for a unified portal and Single Sign-On (SSO) system for small to medium-sized enterprises. It covers unified login, SSO capabilities, a centralized permission center, application integration, and a secure session management architecture.

### 1.1 Objectives
- **Single Sign-On (SSO)**: Users log in once and access multiple internal systems.
- **Unified Identity (IdP)**: Provide OIDC/OAuth 2.1 authentication services.
- **Centralized Management**: Manage users, departments, roles, permissions, and applications in one place.
- **Portal Interface**: A unified entry point for users to access authorized applications and for admins to manage the system.
- **Security**: Robust session, token, and cookie management to prevent unauthorized access.

---

## 2. Product Scope

### 2.1 In Scope
- **Unified Portal + OIDC Provider**: Portal 自身即为 OIDC Provider，无需独立 IdP 服务。使用 `jose` 库实现纯自定义 ES256 JWT 无状态签发与认证。
- Custom stateless JWT/JTI token issuance with Redis-based emergency revocation.
- Next.js 16-based Management Portal (App Router, Turbopack).
- Standard OIDC/OAuth 2.1 flows (Authorization Code + PKCE).
- RBAC (Role-Based Access Control) with data scope support (ALL/DEPT/DEPT_AND_SUB/SELF/CUSTOM).
- Audit logging for login and administrative actions.
- Session management with idle and absolute timeouts.
- Rust/Pingora API Gateway for offline JWT verification and Cookie-to-Bearer transformation.

### 2.2 Out of Scope
- Large-scale consumer identity management.
- Social logins (OAuth 2.0 with third parties like Google/GitHub).
- Complex policy engines (ABAC/PBAC).
- Multi-tenancy isolation.
- Cross-region high availability.

---

## 3. User Personas

| Persona | Description |
| --- | --- |
| **System Admin** | Manages global organization, users, roles, applications, and system configurations. |
| **Org Admin** | Manages users, departments, and roles within a specific organization/enterprise. |
| **Employee** | Logs into the portal to access authorized menus and sub-applications. |
| **App Admin** | Maintains specific application configurations (client IDs, callback URLs, etc.). |

---

## 4. Functional Requirements

### 4.1 Identity & Authentication
- **User Login**: Support email/username and password authentication.
- **SSO Flow**: Seamless login for sub-applications using the IdP session.
- **Password Management**: Reset and change password capabilities.
- **Logout**: Concurrent invalidation of Portal JWT cookies, JTI revocation, and IdP session.

### 4.2 Permission Center (RBAC)
- **User Management**: CRUD operations, status control (Active/Disabled/Locked).
- **Department Management**: Hierarchical tree structure for organization.
- **Role Management**: Define roles and assign them to users.
- **Permission Mapping**: Link roles to specific permissions (Menus, APIs, Data Scopes).
- **Data Scopes**: Support for `ALL`, `DEPT`, `DEPT_AND_SUB`, `SELF`, and `CUSTOM` filters.

### 4.3 Application Management
- **Client Registration**: Register OAuth 2.1 clients.
- **Configuration**: Manage redirect URIs, scopes, and grant types.
- **Secrets**: Secure generation and rotation of client secrets.

---

## 5. User Journey Examples

1. **Employee Login（员工登录）**:
   - 访问 Portal → Portal 展示登录页 → 输入凭证 → Portal 验证并签发 JWT Cookie（`portal_jwt_token`）→ 进入 Dashboard。
   - 访问子应用（如 ERP）→ 子应用重定向到 Portal OIDC Provider `/authorize` → Portal 识别已有 JWT Cookie → 跳过登录直接签发授权码 → 子应用后端用授权码换取 Token → 用户自动登录。

2. **Admin User Creation（管理员创建用户）**:
   - 管理员在 Portal 中创建新用户 → 用户记录直接写入 PostgreSQL → 用户立即可用初始凭证认证。

---

## 6. Non-Functional Requirements

### 6.1 Performance
- **Portal Metadata**: `/api/me` response time P95 < 200ms.
- **Login Flow**: Complete flow from login start to portal home P95 < 1.5s.
- **Scalability**: Support stateless JWT validation with local JWKS, leveraging Redis only for emergency JTI revocation.

### 6.2 Security
- **Data Protection**: All communications over HTTPS.
- **Token Security**: No sensitive tokens (Access/Refresh) stored in browser storage (LocalStorage/SessionStorage).
- **Session Security**: HttpOnly, Secure, and SameSite=Lax cookies.
- **Auditability**: All critical actions (logins, permission changes) must be logged.

---

## 7. Versioning & Roadmap

- **v1.0 (Current)**: Core SSO（Portal 内建 OIDC Provider）+ RBAC + Gateway 离线 JWT 验证 + 内部应用集成。
- **Future**: MFA (Multi-Factor Authentication), Passkeys, Social Login, Multi-tenancy.
