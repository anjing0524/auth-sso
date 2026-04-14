# Product Requirements Document (PRD) - Auth-SSO

Version: v1.0
Status: Released
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
- Core Identity Provider (IdP) using Better Auth.
- Next.js-based Management Portal.
- Standard OIDC/OAuth 2.1 flows (Authorization Code + PKCE).
- RBAC (Role-Based Access Control) with data scope support.
- Audit logging for login and administrative actions.
- Session management with idle and absolute timeouts.

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
- **Logout**: Concurrent invalidation of Portal and IdP sessions.

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

1. **Employee Login**:
   - Accesses Portal -> Redirected to IdP -> Logs in -> Redirected back to Portal with session established.
   - Accesses "Orders App" -> App redirects to IdP -> IdP recognizes session -> Redirects back with code -> App exchanges code for token -> User is logged in automatically.

2. **Admin User Creation**:
   - Admin creates a new user in Portal -> User identity is automatically provisioned in IdP -> User receives initial credentials.

---

## 6. Non-Functional Requirements

### 6.1 Performance
- **Portal Metadata**: `/api/me` response time P95 < 200ms.
- **Login Flow**: Complete flow from login start to portal home P95 < 1.5s.
- **Scalability**: Support hundreds of concurrent sessions in Redis.

### 6.2 Security
- **Data Protection**: All communications over HTTPS.
- **Token Security**: No sensitive tokens (Access/Refresh) stored in browser storage (LocalStorage/SessionStorage).
- **Session Security**: HttpOnly, Secure, and SameSite=Lax cookies.
- **Auditability**: All critical actions (logins, permission changes) must be logged.

---

## 7. Versioning & Roadmap

- **v1.0 (Current)**: Core SSO + RBAC + Internal App Integration.
- **Future**: MFA (Multi-Factor Authentication), Passkeys, Social Login, Multi-tenancy.
