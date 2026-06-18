/**
 * 组织领域表 (Organization Domain Tables)
 *
 * - departments：部门（树形结构）
 * - menus：菜单（树形结构）
 *
 * @module db/schema/org
 */
import { pgTable, text, timestamp, integer, boolean, index } from 'drizzle-orm/pg-core';
import { entityStatusEnum, menuTypeEnum } from './enums';
import { updatedAtColumn } from './helpers';

/**
 * 部门表（自引用树形结构）
 */
export const departments = pgTable('departments', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  code: text('code'),
  sort: integer('sort').default(0),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_departments_parent').on(t.parentId),
]);

/**
 * 菜单表（自引用树形结构）
 */
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
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_menus_parent').on(t.parentId),
]);
