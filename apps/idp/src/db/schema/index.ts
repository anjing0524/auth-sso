/**
 * Auth-SSO 数据库 Schema
 * 统一导出所有表定义
 */
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
// 枚举定义
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
// 用户表
// ============================================

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  emailVerified: boolean('email_verified').default(false),
  mobile: text('mobile').unique(),
  mobileVerified: boolean('mobile_verified').default(false),
  passwordHash: text('password_hash'), // 历史遗留，兼容旧系统
  password: text('password'), // Better Auth 密码字段
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  status: userStatusEnum('status').notNull().default('ACTIVE'),
  deptId: text('dept_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
});

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  userRoles: many(userRoles),
}));

// ============================================
// Session 表 (Better Auth 兼容)
// ============================================

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
});

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// ============================================
// Account 表 (Better Auth 兼容)
// ============================================

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'), // Better Auth 密码存储字段 (credential provider)
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

// ============================================
// 验证码表
// ============================================

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================
// 部门表
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

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  parent: one(departments, {
    fields: [departments.parentId],
    references: [departments.id],
    relationName: 'subDepartments',
  }),
  subDepartments: many(departments, {
    relationName: 'subDepartments',
  }),
}));

// ============================================
// 角色表
// ============================================

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

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
}));

// ============================================
// 权限表
// ============================================

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

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

// ============================================
// 用户-角色关联表
// ============================================

export const userRoles = pgTable('user_roles', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

// ============================================
// 角色-权限关联表
// ============================================

export const rolePermissions = pgTable('role_permissions', {
  id: text('id').primaryKey(),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: text('permission_id')
    .notNull()
    .references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

// ============================================
// 角色-数据范围关联表
// ============================================

export const roleDataScopes = pgTable('role_data_scopes', {
  id: text('id').primaryKey(),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  deptId: text('dept_id')
    .notNull()
    .references(() => departments.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================
// OIDC 客户端表 (Better Auth OIDC Provider 兼容)
// ============================================

export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  name: text('name').notNull(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  redirectUris: text('redirect_uris').notNull(), // JSON string array
  grantTypes: text('grant_types').notNull().default('["authorization_code","refresh_token"]'), // JSON string array
  scopes: text('scopes').notNull().default('openid profile email offline_access'), // Space-separated string
  homepageUrl: text('homepage_url'),
  logoUrl: text('logo_url'),
  accessTokenTtl: integer('access_token_ttl').default(3600),
  refreshTokenTtl: integer('refresh_token_ttl').default(604800),
  status: clientStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // Better Auth OIDC Provider 额外需要的字段
  disabled: boolean('disabled').default(false),
  skipConsent: boolean('skip_consent').default(false),
  userId: text('user_id'),
});

export const clientsRelations = relations(clients, ({ many }) => ({
  authorizationCodes: many(authorizationCodes),
  oauthTokens: many(oauthTokens),
}));

// ============================================
// 授权码表
// ============================================

export const authorizationCodes = pgTable('authorization_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  clientId: text('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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

export const authorizationCodesRelations = relations(authorizationCodes, ({ one }) => ({
  client: one(clients, {
    fields: [authorizationCodes.clientId],
    references: [clients.id],
  }),
}));

// ============================================
// OAuth Token 表 (旧版，保留用于数据迁移)
// ============================================

export const oauthTokens = pgTable('oauth_tokens', {
  id: text('id').primaryKey(),
  accessToken: text('access_token').notNull().unique(),
  refreshToken: text('refresh_token').unique(),
  idToken: text('id_token'),
  clientId: text('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at').notNull(),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  revoked: boolean('revoked').default(false),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================
// OAuth Access Token 表 (Better Auth OIDC Provider 兼容)
// ============================================

export const oauthAccessTokens = pgTable('oauth_access_tokens', {
  id: text('id').primaryKey(),
  token: text('token').unique(), // Better Auth 使用 accessToken 字段，此字段可选
  accessToken: text('access_token'), // Better Auth 主字段
  refreshToken: text('refresh_token'), // Better Auth 兼容字段
  accessTokenExpiresAt: timestamp('access_token_expires_at'), // Better Auth 过期时间字段
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'), // Better Auth 兼容字段
  clientId: text('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'),
  refreshId: text('refresh_id'),
  referenceId: text('reference_id'),
  scopes: text('scopes').notNull(), // JSON array
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'), // 可选字段
});

// ============================================
// OAuth Refresh Token 表 (Better Auth OIDC Provider 兼容)
// ============================================

export const oauthRefreshTokens = pgTable('oauth_refresh_tokens', {
  id: text('id').primaryKey(),
  token: text('token').unique(), // Better Auth 使用 refreshToken 字段，此字段可选
  refreshToken: text('refresh_token'), // Better Auth 主字段
  clientId: text('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'),
  referenceId: text('reference_id'),
  scopes: text('scopes').notNull(), // JSON array
  revoked: timestamp('revoked'),
  authTime: timestamp('auth_time'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'), // 可选字段
});

export const oauthTokensRelations = relations(oauthTokens, ({ one }) => ({
  client: one(clients, {
    fields: [oauthTokens.clientId],
    references: [clients.id],
  }),
}));

// ============================================
// OAuth 授权同意表 (Better Auth OIDC Provider 兼容)
// ============================================

export const oauthConsent = pgTable('oauth_consent', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  referenceId: text('reference_id'),
  scopes: text('scopes').notNull(), // Comma-separated list of scopes
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================
// JWKS 表 (Better Auth JWT 插件)
// ============================================

export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});

// ============================================
// 审计日志表
// ============================================

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

// ============================================
// 登录日志表
// ============================================

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

// ============================================
// 菜单表
// ============================================

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

// ============================================
// 类型导出
// ============================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type AuthorizationCode = typeof authorizationCodes.$inferSelect;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type LoginLog = typeof loginLogs.$inferSelect;
export type Menu = typeof menus.$inferSelect;