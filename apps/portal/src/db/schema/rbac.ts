/**
 * RBAC 权限领域表 (Role-Based Access Control Tables)
 *
 * - roles：角色
 * - permissions：权限点
 * - rolePermissions：角色↔权限 关联
 * - roleDataScopes：角色↔部门 数据范围
 * - roleClients：角色↔Client 关联
 *
 * ## FK 约定说明
 *
 * permissions.clientId 和 roleClients.clientId 引用 clients.clientId（业务键）
 * 而非 clients.id。这是**刻意设计**，原因：
 *
 * 1. Gateway (Rust/Pingora) 直接从 permissions 表读取 client_id 用于 JWT 校验，
 *    它期望的是业务 client_id 而非内部 UUID
 * 2. 权限注册路由 (POST /api/permissions/register) 使用 Basic Auth 的 client_id
 *    直接匹配，避免额外的 clients 表查询
 * 3. clients.client_id 具有 UNIQUE 约束，引用完整性等价于引用 id
 *
 * 其他表（access_tokens / refresh_tokens / authorization_codes / consents）
 * 的 clientId 引用的是 clients.id，因为它们是 OAuth 协议内部流转，
 * 不暴露给外部系统。
 *
 * @module db/schema/rbac
 */
import { pgTable, text, timestamp, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { entityStatusEnum, dataScopeTypeEnum, permissionTypeEnum } from './enums';
import { clients } from './auth';
import { departments } from './org';
import { updatedAtColumn } from './helpers';

/**
 * 角色表
 */
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
  updatedAt: updatedAtColumn(),
});

/**
 * 权限点表
 */
export const permissions = pgTable('permissions', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  type: permissionTypeEnum('type').notNull().default('API'),
  resource: text('resource'),
  action: text('action'),
  parentId: text('parent_id'),
  // 业务 client_id（见模块注释）
  clientId: text('client_id').references(() => clients.clientId, { onDelete: 'cascade' }),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  sort: integer('sort').default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_permissions_client').on(t.clientId),
  index('idx_permissions_parent').on(t.parentId),
]);

/**
 * 角色↔权限 关联表
 */
export const rolePermissions = pgTable('role_permissions', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: text('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_role_permissions_role').on(t.roleId),
  index('idx_role_permissions_permission').on(t.permissionId),
  // DB 层拦截同一角色重复绑定同一权限（数据完整性）
  uniqueIndex('ux_role_permissions_role_perm').on(t.roleId, t.permissionId),
]);

/**
 * 角色↔部门 数据范围关联表
 */
export const roleDataScopes = pgTable('role_data_scopes', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  deptId: text('dept_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_role_data_scopes_role').on(t.roleId),
  index('idx_role_data_scopes_dept').on(t.deptId),
  // DB 层拦截同一角色重复绑定同一部门数据范围（数据完整性）
  uniqueIndex('ux_role_data_scopes_role_dept').on(t.roleId, t.deptId),
]);

/**
 * 角色↔Client 关联表（业务 client_id）
 */
export const roleClients = pgTable('role_clients', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.clientId, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_role_clients_role').on(t.roleId),
  index('idx_role_clients_client').on(t.clientId),
  // DB 层拦截同一角色重复绑定同一 Client（数据完整性）
  uniqueIndex('ux_role_clients_role_client').on(t.roleId, t.clientId),
]);
