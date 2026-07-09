CREATE TYPE "public"."audit_operation" AS ENUM('USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'USER_ROLE_ASSIGN', 'ROLE_CREATE', 'ROLE_UPDATE', 'ROLE_DELETE', 'ROLE_PERMISSION_ASSIGN', 'PERMISSION_CREATE', 'PERMISSION_UPDATE', 'PERMISSION_DELETE', 'DEPARTMENT_CREATE', 'DEPARTMENT_UPDATE', 'DEPARTMENT_DELETE', 'CLIENT_CREATE', 'CLIENT_UPDATE', 'CLIENT_DELETE', 'CLIENT_SECRET_REGENERATE', 'TOKEN_REVOKE');--> statement-breakpoint
CREATE TYPE "public"."code_challenge_method" AS ENUM('S256');--> statement-breakpoint
CREATE TYPE "public"."entity_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."login_event" AS ENUM('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESH', 'TOKEN_REFRESH_FAILED');--> statement-breakpoint
CREATE TYPE "public"."permission_type" AS ENUM('DIRECTORY', 'PAGE', 'API', 'DATA');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED', 'LOCKED', 'DELETED');--> statement-breakpoint
CREATE TABLE "access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"client_id" varchar(50) NOT NULL,
	"user_id" uuid NOT NULL,
	"scopes" varchar(200) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"client_id" varchar(50) NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_uri" varchar(500) NOT NULL,
	"scope" varchar(200) NOT NULL,
	"state" varchar(100),
	"nonce" varchar(100),
	"code_challenge" varchar(100),
	"code_challenge_method" "code_challenge_method" DEFAULT 'S256',
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authorization_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"client_id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"client_secret" varchar(128),
	"redirect_uris" varchar(255)[] NOT NULL,
	"scopes" varchar(200) DEFAULT 'openid profile email offline_access' NOT NULL,
	"homepage_url" varchar(500),
	"logo_url" varchar(500),
	"access_token_ttl" integer DEFAULT 3600,
	"refresh_token_ttl" integer DEFAULT 604800,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kid" varchar(50) NOT NULL,
	"algorithm" varchar(10) DEFAULT 'ES256',
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "jwks_kid_unique" UNIQUE("kid")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"client_id" varchar(50) NOT NULL,
	"user_id" uuid NOT NULL,
	"scopes" varchar(200) NOT NULL,
	"revoked" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(50) NOT NULL,
	"email" varchar(255),
	"email_verified" boolean DEFAULT false NOT NULL,
	"mobile" varchar(20),
	"mobile_verified" boolean DEFAULT false NOT NULL,
	"password_hash" varchar(128),
	"name" varchar(100) NOT NULL,
	"avatar_url" varchar(500),
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"dept_id" uuid,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_mobile_unique" UNIQUE("mobile")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"type" "permission_type" DEFAULT 'API' NOT NULL,
	"path" varchar(200),
	"icon" varchar(50),
	"visible" boolean,
	"resource" varchar(100),
	"action" varchar(50),
	"client_id" varchar(50),
	"parent_id" uuid,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code"),
	CONSTRAINT "permissions_type_fields_chk" CHECK ((type IN ('DIRECTORY','PAGE') AND resource IS NULL AND action IS NULL AND client_id IS NULL)
      OR (type IN ('API','DATA') AND resource IS NOT NULL AND action IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"dept_id" uuid NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" varchar(100) NOT NULL,
	"code" varchar(50),
	"ancestors" varchar(500),
	"sort" smallint DEFAULT 0 NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" varchar(50),
	"method" varchar(10) NOT NULL,
	"path" varchar(500) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" varchar(64),
	"ip" "inet",
	"user_agent" varchar(500),
	"status" smallint,
	"duration" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" varchar(50),
	"operation" "audit_operation" NOT NULL,
	"method" varchar(10),
	"url" varchar(500),
	"params" jsonb,
	"ip" "inet",
	"user_agent" varchar(500),
	"status" smallint,
	"duration" integer,
	"error_msg" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" varchar(50) NOT NULL,
	"event_type" "login_event" NOT NULL,
	"ip" "inet",
	"user_agent" varchar(500),
	"location" varchar(100),
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_access_tokens_client" ON "access_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_access_tokens_user" ON "access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_client" ON "refresh_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_user_roles_pk" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "idx_user_roles_role" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status") WHERE "users"."status" <> 'DELETED';--> statement-breakpoint
CREATE INDEX "idx_users_dept" ON "users" USING btree ("dept_id");--> statement-breakpoint
CREATE INDEX "idx_users_deleted_at" ON "users" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_permissions_client" ON "permissions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_permissions_parent" ON "permissions" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_permissions_type" ON "permissions" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_role_permissions_pk" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX "idx_role_permissions_permission" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "idx_departments_parent" ON "departments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_departments_ancestors" ON "departments" USING btree ("ancestors");--> statement-breakpoint
CREATE INDEX "idx_access_logs_user" ON "access_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_access_logs_created" ON "access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_access_logs_resource" ON "access_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_operation" ON "audit_logs" USING btree ("operation");--> statement-breakpoint
CREATE INDEX "idx_login_logs_user" ON "login_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_login_logs_created" ON "login_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_login_logs_event_type" ON "login_logs" USING btree ("event_type");