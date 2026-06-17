-- ============================================
-- Auth-SSO Portal 完整初始化 Schema
-- 去 Better Auth，纯无状态 JWT 架构
-- ============================================

-- 枚举类型（对齐 @auth-sso/contracts 唯一真相源）
CREATE TYPE "user_status" AS ENUM('ACTIVE', 'DISABLED', 'LOCKED', 'DELETED');
CREATE TYPE "entity_status" AS ENUM('ACTIVE', 'DISABLED');
CREATE TYPE "data_scope_type" AS ENUM('ALL', 'DEPT', 'DEPT_AND_SUB', 'SELF', 'CUSTOM');
CREATE TYPE "permission_type" AS ENUM('MENU', 'API', 'DATA');
CREATE TYPE "menu_type" AS ENUM('DIRECTORY', 'MENU', 'BUTTON');

-- ============================================
-- 用户表
-- ============================================
CREATE TABLE "users" (
  "id" text PRIMARY KEY NOT NULL,
  "public_id" text NOT NULL UNIQUE,
  "username" text NOT NULL UNIQUE,
  "email" text UNIQUE,
  "email_verified" boolean DEFAULT false,
  "mobile" text UNIQUE,
  "mobile_verified" boolean DEFAULT false,
  "password_hash" text,
  "name" text NOT NULL,
  "avatar_url" text,
  "status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
  "dept_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "last_login_at" timestamp
);

-- ============================================
-- OIDC 核心表（规范命名，无 Better Auth 兼容）
-- ============================================

-- OAuth 2.1 客户端
CREATE TABLE "clients" (
  "id" text PRIMARY KEY NOT NULL,
  "public_id" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "client_id" text NOT NULL UNIQUE,
  "client_secret" text,
  "redirect_uris" text NOT NULL,
  "scopes" text DEFAULT 'openid profile email offline_access' NOT NULL,
  "homepage_url" text,
  "logo_url" text,
  "access_token_ttl" integer DEFAULT 3600,
  "refresh_token_ttl" integer DEFAULT 604800,
  "status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- 授权码
CREATE TABLE "authorization_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL UNIQUE,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "redirect_uri" text NOT NULL,
  "scope" text NOT NULL,
  "state" text,
  "nonce" text,
  "code_challenge" text,
  "code_challenge_method" text DEFAULT 'S256',
  "expires_at" timestamp NOT NULL,
  "used" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Access Token（用于 introspection + revocation）
CREATE TABLE "access_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text UNIQUE,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "scopes" text NOT NULL,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Refresh Token（用于 rotation + revocation）
CREATE TABLE "refresh_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text UNIQUE,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "scopes" text NOT NULL,
  "revoked" timestamp,
  "auth_time" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);

-- OAuth Consent
CREATE TABLE "consents" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "scopes" text NOT NULL,
  "consent_given" boolean,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- JWKS 密钥对
CREATE TABLE "jwks" (
  "id" text PRIMARY KEY NOT NULL,
  "kid" text UNIQUE,
  "algorithm" text DEFAULT 'ES256',
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);

-- ============================================
-- 业务管理表
-- ============================================

CREATE TABLE "departments" (
  "id" text PRIMARY KEY NOT NULL,
  "public_id" text NOT NULL UNIQUE,
  "parent_id" text,
  "name" text NOT NULL,
  "code" text,
  "sort" integer DEFAULT 0,
  "status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "roles" (
  "id" text PRIMARY KEY NOT NULL,
  "public_id" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "code" text NOT NULL UNIQUE,
  "description" text,
  "data_scope_type" "data_scope_type" DEFAULT 'SELF' NOT NULL,
  "is_system" boolean DEFAULT false,
  "status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
  "sort" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "permissions" (
  "id" text PRIMARY KEY NOT NULL,
  "public_id" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "code" text NOT NULL UNIQUE,
  "type" "permission_type" DEFAULT 'API' NOT NULL,
  "resource" text,
  "action" text,
  "parent_id" text,
  "client_id" text REFERENCES "clients"("client_id") ON DELETE CASCADE,
  "status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
  "sort" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "user_roles" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role_id" text NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "role_permissions" (
  "id" text PRIMARY KEY NOT NULL,
  "role_id" text NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "permission_id" text NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "role_data_scopes" (
  "id" text PRIMARY KEY NOT NULL,
  "role_id" text NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "dept_id" text NOT NULL REFERENCES "departments"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "role_clients" (
  "id" text PRIMARY KEY NOT NULL,
  "role_id" text NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL REFERENCES "clients"("client_id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ============================================
-- 日志表
-- ============================================

CREATE TABLE "audit_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text,
  "username" text,
  "operation" text NOT NULL,
  "method" text,
  "url" text,
  "params" text,
  "ip" text,
  "user_agent" text,
  "status" integer,
  "duration" integer,
  "error_msg" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "login_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text,
  "username" text NOT NULL,
  "event_type" text NOT NULL,
  "ip" text,
  "user_agent" text,
  "location" text,
  "fail_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "menus" (
  "id" text PRIMARY KEY NOT NULL,
  "public_id" text NOT NULL UNIQUE,
  "parent_id" text,
  "name" text NOT NULL,
  "path" text,
  "permission_code" text,
  "icon" text,
  "component" text,
  "visible" boolean DEFAULT true,
  "sort" integer DEFAULT 0,
  "menu_type" "menu_type" DEFAULT 'MENU' NOT NULL,
  "status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
