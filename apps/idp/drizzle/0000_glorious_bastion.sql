CREATE TYPE "public"."client_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('confidential', 'public');--> statement-breakpoint
CREATE TYPE "public"."data_scope_type" AS ENUM('ALL', 'DEPT', 'DEPT_AND_SUB', 'SELF', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."entity_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."permission_type" AS ENUM('MENU', 'API', 'DATA');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED', 'LOCKED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "authorization_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text NOT NULL,
	"state" text,
	"nonce" text,
	"code_challenge" text,
	"code_challenge_method" text DEFAULT 'S256',
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "authorization_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_type" "client_type" DEFAULT 'confidential' NOT NULL,
	"redirect_uris" text NOT NULL,
	"grant_types" text DEFAULT '["authorization_code","refresh_token"]' NOT NULL,
	"scopes" text DEFAULT 'openid profile email offline_access' NOT NULL,
	"homepage_url" text,
	"logo_url" text,
	"access_token_ttl" integer DEFAULT 3600,
	"refresh_token_ttl" integer DEFAULT 604800,
	"status" "client_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clients_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"code" text,
	"sort" integer DEFAULT 0,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"path" text,
	"icon" text,
	"component" text,
	"visible" boolean DEFAULT true,
	"sort" integer DEFAULT 0,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "menus_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"id_token" text,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"access_token_expires_at" timestamp NOT NULL,
	"refresh_token_expires_at" timestamp,
	"revoked" boolean DEFAULT false,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_access_token_unique" UNIQUE("access_token"),
	CONSTRAINT "oauth_tokens_refresh_token_unique" UNIQUE("refresh_token")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"type" "permission_type" DEFAULT 'API' NOT NULL,
	"resource" text,
	"action" text,
	"parent_id" text,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"sort" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_data_scopes" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"dept_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"data_scope_type" "data_scope_type" DEFAULT 'SELF' NOT NULL,
	"is_system" boolean DEFAULT false,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"sort" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false,
	"mobile" text,
	"mobile_verified" boolean DEFAULT false,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"dept_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp,
	CONSTRAINT "users_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_mobile_unique" UNIQUE("mobile")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_data_scopes" ADD CONSTRAINT "role_data_scopes_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_data_scopes" ADD CONSTRAINT "role_data_scopes_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;