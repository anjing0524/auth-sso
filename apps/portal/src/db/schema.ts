import {
  pgTable,
  text,
  timestamp,
  boolean,
  pgEnum,
  integer,
} from 'drizzle-orm/pg-core';
import {
  USER_STATUS_VALUES,
  ENTITY_STATUS_VALUES,
  DATA_SCOPE_TYPE_VALUES,
  PERMISSION_TYPE_VALUES,
  MENU_TYPE_VALUES,
} from '@auth-sso/contracts';

// ============================================
// 枚举定义 (严格对齐 contracts，单一真相源)
// ============================================

export const userStatusEnum = pgEnum('user_status', USER_STATUS_VALUES as unknown as [string, ...string[]]);
export const entityStatusEnum = pgEnum('entity_status', ENTITY_STATUS_VALUES as unknown as [string, ...string[]]);
export const dataScopeTypeEnum = pgEnum('data_scope_type', DATA_SCOPE_TYPE_VALUES as unknown as [string, ...string[]]);
export const permissionTypeEnum = pgEnum('permission_type', PERMISSION_TYPE_VALUES as unknown as [string, ...string[]]);
export const menuTypeEnum = pgEnum('menu_type', MENU_TYPE_VALUES as unknown as [string, ...string[]]);

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
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  status: userStatusEnum('status').notNull().default('ACTIVE'),
  deptId: text('dept_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
});

// ============================================
// OIDC 核心表 (去 Better Auth 兼容，规范命名)
// ============================================

/** OAuth 2.1 客户端应用 */
export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  name: text('name').notNull(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  redirectUrls: text('redirect_uris').notNull(),
  scopes: text('scopes').notNull().default('openid profile email offline_access'),
  homepageUrl: text('homepage_url'),
  icon: text('logo_url'),
  accessTokenTtl: integer('access_token_ttl').default(3600),
  refreshTokenTtl: integer('refresh_token_ttl').default(604800),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** OAuth 2.1 授权码 */
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

/** Access Token (用于 introspection + revocation) */
export const accessTokens = pgTable('access_tokens', {
  id: text('id').primaryKey(),
  token: text('token').unique(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** Refresh Token (用于 rotation + revocation) */
export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  token: text('token').unique(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  revoked: timestamp('revoked'),
  authTime: timestamp('auth_time'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});

/** OAuth Consent 授权记录 */
export const consents = pgTable('consents', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  consentGiven: boolean('consent_given'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** JWKS 密钥对 */
export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  kid: text('kid').unique(),
  algorithm: text('algorithm').default('ES256'),
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
  clientId: text('client_id').references(() => clients.clientId, { onDelete: 'cascade' }),
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

export const roleClients = pgTable('role_clients', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.clientId, { onDelete: 'cascade' }),
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
  permissionCode: text('permission_code'),
  icon: text('icon'),
  component: text('component'),
  visible: boolean('visible').default(true),
  sort: integer('sort').default(0),
  menuType: menuTypeEnum('menu_type').notNull().default('MENU'),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================
// 编译期类型同步守卫 (Domain ↔ Drizzle 不漂移)
// ============================================
import type { User } from '@/domain/user/types';
import type { EntityStatus, DataScopeType, PermissionType, MenuType } from '@auth-sso/contracts';
import type { Department } from '@/domain/department/types';
import type { Role } from '@/domain/role/types';
import type { Permission } from '@/domain/permission/types';
import type { Menu } from '@/domain/menu/types';
import type { Client } from '@/domain/client/types';

type UserRow = typeof users.$inferSelect;
type DeptRow = typeof departments.$inferSelect;
type RoleRow = typeof roles.$inferSelect;
type PermRow = typeof permissions.$inferSelect;
type MenuRow = typeof menus.$inferSelect;
type ClientRow = typeof clients.$inferSelect;

// 守卫：Drizzle 行类型必须兼容 Domain 实体
type _UserRowCompatible = UserRow extends Omit<User, 'deptName' | 'createdAt'> ? true : never;
type _DeptRowCompatible = DeptRow extends Omit<Department, 'createdAt'> ? true : never;
type _RoleRowCompatible = RoleRow extends Omit<Role, 'createdAt'> ? true : never;
type _PermRowCompatible = PermRow extends Omit<Permission, 'createdAt'> ? true : never;
type _MenuRowCompatible = MenuRow extends Omit<Menu, 'createdAt'> ? true : never;
type _ClientRowCompatible = ClientRow extends Omit<Client, 'createdAt'> ? true : never;

// 守卫：枚举取值双向穷举
type _UserStatusInRow = UserRow['status'] extends import('@auth-sso/contracts').UserStatus ? true : never;
type _UserStatusInDomain = import('@auth-sso/contracts').UserStatus extends UserRow['status'] ? true : never;
type _DeptStatusInRow = DeptRow['status'] extends EntityStatus ? true : never;
type _DeptStatusInDomain = EntityStatus extends DeptRow['status'] ? true : never;
type _RoleStatusInRow = RoleRow['status'] extends EntityStatus ? true : never;
type _RoleStatusInDomain = EntityStatus extends RoleRow['status'] ? true : never;
type _RoleScopeInRow = RoleRow['dataScopeType'] extends DataScopeType ? true : never;
type _RoleScopeInDomain = DataScopeType extends RoleRow['dataScopeType'] ? true : never;
type _PermStatusInRow = PermRow['status'] extends EntityStatus ? true : never;
type _PermStatusInDomain = EntityStatus extends PermRow['status'] ? true : never;
type _PermTypeInRow = PermRow['type'] extends PermissionType ? true : never;
type _PermTypeInDomain = PermissionType extends PermRow['type'] ? true : never;
type _MenuStatusInRow = MenuRow['status'] extends EntityStatus ? true : never;
type _MenuStatusInDomain = EntityStatus extends MenuRow['status'] ? true : never;
type _MenuTypeInRow = MenuRow['menuType'] extends MenuType ? true : never;
type _MenuTypeInDomain = MenuType extends MenuRow['menuType'] ? true : never;
type _ClientStatusInRow = ClientRow['status'] extends EntityStatus ? true : never;
type _ClientStatusInDomain = EntityStatus extends ClientRow['status'] ? true : never;
