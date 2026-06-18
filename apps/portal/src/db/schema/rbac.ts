/**
 * RBAC 权限领域表 (Role-Based Access Control Tables)
 *
 * - roles：角色
 * - permissions：权限点
 * - rolePermissions：角色↔权限 关联
 * - roleDataScopes：角色↔部门 数据范围
 * - roleClients：角色↔Client 关联
 *
 * 注：permissions.clientId / roleClients.clientId 存储的是业务 client_id
 * （被 gateway 与权限注册路由直接消费），因此 FK 指向 clients.clientId（unique）。
 * 这是与 DATABASE.md §2「FK 引用 internal id」的刻意例外，避免破坏外部契约。
 *
 * @module db/schema/rbac
 */
import { pgTable, text, timestamp, boolean, integer, index } from 'drizzle-orm/pg-core';
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
]);
