import {
  pgTable,
  text,
  timestamp,
  boolean,
  pgEnum,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================
// 枚举定义 (严格对齐 Portal)
// ============================================

export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'DISABLED', 'LOCKED']);
export const entityStatusEnum = pgEnum('entity_status', ['ACTIVE', 'DISABLED']);
export const dataScopeTypeEnum = pgEnum('data_scope_type', [
  'ALL',
  'DEPT',
  'DEPT_AND_SUB',
  'SELF',
  'CUSTOM',
]);
export const permissionTypeEnum = pgEnum('permission_type', ['MENU', 'API', 'DATA']);
export const clientTypeEnum = pgEnum('client_type', ['confidential', 'public']);
export const clientStatusEnum = pgEnum('client_status', ['ACTIVE', 'DISABLED']);

// ============================================
// 核心用户表
// ============================================

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  emailVerified: boolean('email_verified').default(false),
  mobile: text('mobile').unique(),
  mobileVerified: boolean('mobile_verified').default(false),
  passwordHash: text('password_hash'), 
  password: text('password'),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  status: userStatusEnum('status').notNull().default('ACTIVE'),
  deptId: text('dept_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
});

// ============================================
// Better Auth 兼容表
// ============================================

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
});

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================
// OIDC 核心表
// ============================================

export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  name: text('name').notNull(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  redirectUrls: text('redirect_uris').notNull(),
  grantTypes: text('grant_types').notNull().default('["authorization_code","refresh_token"]'),
  scopes: text('scopes').notNull().default('openid profile email offline_access'),
  homepageUrl: text('homepage_url'),
  icon: text('logo_url'),
  accessTokenTtl: integer('access_token_ttl').default(3600),
  refreshTokenTtl: integer('refresh_token_ttl').default(604800),
  status: clientStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  disabled: boolean('disabled').default(false),
  skipConsent: boolean('skip_consent').default(false), // 核心：控制静默授权
  userId: text('user_id'),
});

export const authorizationCodes = pgTable('authorization_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull(),
  state: text('state'),
  nonce: text('nonce'),
  codeChallenge: text('code_challenge'),
  codeChallengeMethod: text('code_challenge_method').default('S256'),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const oauthAccessTokens = pgTable('oauth_access_tokens', {
  id: text('id').primaryKey(),
  accessToken: text('access_token'),
  token: text('token').unique(),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'),
  refreshId: text('refresh_id'),
  referenceId: text('reference_id'),
  scopes: text('scopes').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});

export const oauthRefreshTokens = pgTable('oauth_refresh_tokens', {
  id: text('id').primaryKey(),
  refreshToken: text('refresh_token'),
  token: text('token').unique(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'),
  referenceId: text('reference_id'),
  scopes: text('scopes').notNull(),
  revoked: timestamp('revoked'),
  authTime: timestamp('auth_time'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});

export const oauthConsent = pgTable('oauth_consent', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  referenceId: text('reference_id'),
  scopes: text('scopes').notNull(),
  consentGiven: boolean('consent_given'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});

// ============================================
// 业务管理表 (Portal 专用)
// ============================================

export const departments = pgTable('departments', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  code: text('code'),
  sort: integer('sort').default(0),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  description: text('description'),
  dataScopeType: dataScopeTypeEnum('data_scope_type').notNull().default('SELF'),
  isSystem: boolean('is_system').default(false),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  sort: integer('sort').default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const permissions = pgTable('permissions', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  type: permissionTypeEnum('type').notNull().default('API'),
  resource: text('resource'),
  action: text('action'),
  parentId: text('parent_id'),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  sort: integer('sort').default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const userRoles = pgTable('user_roles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const rolePermissions = pgTable('role_permissions', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: text('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const roleDataScopes = pgTable('role_data_scopes', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  deptId: text('dept_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  username: text('username'),
  operation: text('operation').notNull(),
  method: text('method'),
  url: text('url'),
  params: text('params'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  status: integer('status'),
  duration: integer('duration'),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const loginLogs = pgTable('login_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  username: text('username').notNull(),
  eventType: text('event_type').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  location: text('location'),
  failReason: text('fail_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const menus = pgTable('menus', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  path: text('path'),
  icon: text('icon'),
  component: text('component'),
  visible: boolean('visible').default(true),
  sort: integer('sort').default(0),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
