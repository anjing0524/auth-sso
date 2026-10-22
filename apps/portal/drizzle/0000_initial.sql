CREATE TYPE audit_operation AS ENUM ('USER_CREATE','USER_UPDATE','USER_DELETE','USER_ROLE_ASSIGN','ROLE_CREATE','ROLE_UPDATE','ROLE_DELETE','ROLE_PERMISSION_ASSIGN','PERMISSION_CREATE','PERMISSION_UPDATE','PERMISSION_DELETE','DEPARTMENT_CREATE','DEPARTMENT_UPDATE','DEPARTMENT_DELETE','CLIENT_CREATE','CLIENT_UPDATE','CLIENT_DELETE','CLIENT_SECRET_REGENERATE','TOKEN_REVOKE');
CREATE TYPE code_challenge_method AS ENUM ('S256');
CREATE TYPE entity_status AS ENUM ('ACTIVE','DISABLED');
CREATE TYPE login_event AS ENUM ('LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT','TOKEN_REFRESH','TOKEN_REFRESH_FAILED');
CREATE TYPE permission_type AS ENUM ('DIRECTORY','PAGE','API');
CREATE TYPE user_status AS ENUM ('ACTIVE','DISABLED','LOCKED','DELETED');

CREATE TABLE departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid, name varchar(100) NOT NULL, code varchar(50) UNIQUE, ancestors varchar(500), sort smallint NOT NULL DEFAULT 0, status entity_status NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username varchar(50) NOT NULL UNIQUE, email varchar(255), email_verified boolean NOT NULL DEFAULT false, mobile varchar(20), mobile_verified boolean NOT NULL DEFAULT false, password_hash varchar(128), password_history text[], name varchar(100) NOT NULL, avatar_url varchar(500), status user_status NOT NULL DEFAULT 'ACTIVE', dept_id uuid REFERENCES departments(id) ON DELETE SET NULL, last_login_at timestamptz, deleted_at timestamptz, password_changed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT users_password_history_len_chk CHECK (password_history IS NULL OR array_length(password_history, 1) <= 10));
CREATE TABLE clients (client_id varchar(50) PRIMARY KEY, name varchar(100) NOT NULL, client_secret varchar(128), redirect_uris varchar(255)[] NOT NULL, scopes varchar(200) NOT NULL DEFAULT 'openid profile email offline_access', homepage_url varchar(500), logo_url varchar(500), access_token_ttl integer NOT NULL DEFAULT 3600, refresh_token_ttl integer NOT NULL DEFAULT 604800, status entity_status NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(100) NOT NULL, code varchar(50) NOT NULL UNIQUE, description text, dept_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE, is_system boolean NOT NULL DEFAULT false, status entity_status NOT NULL DEFAULT 'ACTIVE', sort smallint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(150) NOT NULL UNIQUE, name varchar(100) NOT NULL, description text, type permission_type NOT NULL DEFAULT 'API', path varchar(200), icon varchar(50), visible boolean, client_id varchar(50) REFERENCES clients(client_id) ON DELETE CASCADE, parent_id uuid REFERENCES permissions(id) ON DELETE CASCADE, status entity_status NOT NULL DEFAULT 'ACTIVE', sort smallint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT permissions_type_fields_chk CHECK ((type IN ('DIRECTORY','PAGE') AND client_id IS NULL) OR type = 'API'));
CREATE TABLE user_roles (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, role_id));
CREATE TABLE role_permissions (role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (role_id, permission_id));
CREATE TABLE authorization_codes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(100) NOT NULL UNIQUE, client_id varchar(50) NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, redirect_uri varchar(500) NOT NULL, scope varchar(200) NOT NULL, state varchar(100), nonce varchar(100), code_challenge varchar(100), code_challenge_method code_challenge_method DEFAULT 'S256', expires_at timestamptz NOT NULL, used boolean DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE access_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash varchar(64) NOT NULL UNIQUE, client_id varchar(50) NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, scopes varchar(200) NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE refresh_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash varchar(64) NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, scopes varchar(200) NOT NULL, revoked timestamptz, auth_time timestamptz, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE jwks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kid varchar(50) NOT NULL UNIQUE, algorithm varchar(10) DEFAULT 'ES256', public_key text NOT NULL, private_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz);
CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, username varchar(50), operation audit_operation NOT NULL, method varchar(10), url varchar(500), params jsonb, ip inet, user_agent varchar(500), status smallint, duration integer, error_msg text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE login_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, username varchar(50) NOT NULL, event_type login_event NOT NULL, ip inet, user_agent varchar(500), location varchar(100), fail_reason text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE access_logs (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, username varchar(50), method varchar(10) NOT NULL, path varchar(500) NOT NULL, resource_type varchar(50), resource_id varchar(64), ip inet, user_agent varchar(500), status smallint, duration integer, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (id, created_at)) PARTITION BY RANGE (created_at);

CREATE INDEX idx_departments_parent ON departments(parent_id); CREATE INDEX idx_departments_ancestors ON departments(ancestors);
CREATE INDEX idx_users_status ON users(status) WHERE status <> 'DELETED'; CREATE INDEX idx_users_dept ON users(dept_id); CREATE INDEX idx_users_deleted_at ON users(deleted_at); CREATE UNIQUE INDEX ux_users_email ON users(email) WHERE deleted_at IS NULL; CREATE UNIQUE INDEX ux_users_mobile ON users(mobile) WHERE deleted_at IS NULL;
CREATE INDEX idx_permissions_client ON permissions(client_id); CREATE INDEX idx_permissions_parent ON permissions(parent_id); CREATE INDEX idx_permissions_type ON permissions(type);
CREATE INDEX idx_user_roles_role ON user_roles(role_id); CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id); CREATE INDEX idx_access_tokens_client ON access_tokens(client_id); CREATE INDEX idx_access_tokens_user ON access_tokens(user_id); CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id); CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id); CREATE INDEX idx_audit_logs_created ON audit_logs(created_at); CREATE INDEX idx_audit_logs_operation ON audit_logs(operation); CREATE INDEX idx_login_logs_user ON login_logs(user_id); CREATE INDEX idx_login_logs_created ON login_logs(created_at); CREATE INDEX idx_login_logs_event_type ON login_logs(event_type); CREATE INDEX idx_login_logs_user_event_created ON login_logs(user_id,event_type,created_at);
CREATE INDEX idx_access_logs_user ON access_logs(user_id); CREATE INDEX idx_access_logs_created ON access_logs(created_at); CREATE INDEX idx_access_logs_resource ON access_logs(resource_type,resource_id);
DO $$
DECLARE
  partition_start date := date_trunc('month', CURRENT_DATE)::date;
  partition_end date;
  partition_name text;
BEGIN
  FOR month_offset IN 0..1 LOOP
    partition_end := (partition_start + interval '1 month')::date;
    partition_name := format('access_logs_%s', to_char(partition_start, 'YYYY_MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF access_logs FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      partition_start,
      partition_end
    );
    partition_start := partition_end;
  END LOOP;
END $$;
