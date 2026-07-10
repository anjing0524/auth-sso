/**
 * RBAC 权限领域表 (Role-Based Access Control Tables)
 *
 * - roles：角色（v3.2：data_scope_type 已移除，由 dept_id 决定数据范围）
 * - permissions：权限统一树
 * - rolePermissions：角色↔权限 复合主键
 *
 * ## permissions 类型鉴别设计
 *
 * type 枚举（DIRECTORY | PAGE | API | DATA）决定字段生效规则：
 * - DIRECTORY: path(可选), icon, visible — 侧边栏折叠组，不参与鉴权
 * - PAGE:      path(必填), icon, visible — 侧边栏路由项
 * - API:       resource(必填), action(必填), client_id — 接口鉴权
 * - DATA:      resource(必填), action(必填) — 数据实体权限
 *
 * PG CHECK 约束确保类型专属字段完整性（第二道防线），
 * 应用层 Zod discriminatedUnion 为第一道防线。
 *
 * ## FK 约定
 *
 * 所有 FK 统一引用目标 PK：
 * - permissions.client_id → clients.client_id（统一引用，不再有 id/client_id 分歧）
 * - roles.dept_id → departments.id（v3.2 新增，角色天生属于一个部门）
 *
 * v3.2 变更（RBAC 模型重构）：
 * - role_data_scopes 表已删除（改为角色 dept_id 决定数据范围）
 * - role_clients 表已删除（client→permission→role→user 链路已闭环）
 * - data_scope_type 枚举已删除
 *
 * @module db/schema/rbac
 */
import { pgTable, uuid, varchar, text, boolean, smallint, index, uniqueIndex, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entityStatusEnum, permissionTypeEnum } from './enums';
import { clients } from './auth';
import { departments } from './org';
import { createdAtColumn, updatedAtColumn } from './helpers';

/**
 * 角色表
 */
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  description: text('description'),
  deptId: uuid('dept_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  isSystem: boolean('is_system').notNull().default(false),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  sort: smallint('sort').notNull().default(0),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/**
 * 权限统一树（合并旧 menus 表）
 *
 * type 鉴别列决定字段生效规则，详见模块注释。
 */
export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  type: permissionTypeEnum('type').notNull().default('API'),
  // DIRECTORY/PAGE 专属
  path: varchar('path', { length: 200 }),
  icon: varchar('icon', { length: 50 }),
  visible: boolean('visible'),
  // API/DATA 专属
  resource: varchar('resource', { length: 100 }),
  action: varchar('action', { length: 50 }),
  // API 专属
  clientId: varchar('client_id', { length: 50 }).references(() => clients.clientId, { onDelete: 'cascade' }),
  // 树形结构（FK 自引用）
  parentId: uuid('parent_id').references((): AnyPgColumn => permissions.id, { onDelete: 'cascade' }),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  sort: smallint('sort').notNull().default(0),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_permissions_client').on(t.clientId),
  index('idx_permissions_parent').on(t.parentId),
  index('idx_permissions_type').on(t.type),
  // CHECK：DIRECTORY/PAGE 不可有 resource/action/client_id；API/DATA 必有 resource/action
  // 应用层 Zod discriminatedUnion 为第一道防线，此为 DB 第二道防线
  check(
    'permissions_type_fields_chk',
    sql`(type IN ('DIRECTORY','PAGE') AND resource IS NULL AND action IS NULL AND client_id IS NULL)
      OR (type IN ('API','DATA') AND resource IS NOT NULL AND action IS NOT NULL)`,
  ),
]);

/**
 * 角色↔权限 关联表（复合主键）
 */
export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: createdAtColumn(),
}, (t) => [
  uniqueIndex('ux_role_permissions_pk').on(t.roleId, t.permissionId),
  index('idx_role_permissions_permission').on(t.permissionId),
]);

