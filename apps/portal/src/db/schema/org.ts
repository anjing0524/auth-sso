/**
 * 组织领域表 (Organization Domain Tables)
 *
 * - departments：部门（自引用树形结构，物化路径 ancestors）
 *
 * v2 变更：
 * - 移除 menus 表（合并进 permissions）
 * - PK 类型 text → uuid，默认 gen_random_uuid()
 * - 业务列 text → varchar(n)
 * - timestamp → timestamptz
 * - 移除 public_id
 *
 * @module db/schema/org
 */
import { pgTable, uuid, varchar, smallint, index } from 'drizzle-orm/pg-core';
import { entityStatusEnum } from './enums';
import { createdAtColumn, updatedAtColumn } from './helpers';

/**
 * 部门表（自引用树形结构 + 物化路径）
 *
 * ancestors 示例：顶级为 NULL，子级为 'dept_001/dept_002'
 * 子树查询：WHERE id = X OR ancestors LIKE X || '/%'
 */
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id'),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).unique(),
  ancestors: varchar('ancestors', { length: 500 }),
  sort: smallint('sort').notNull().default(0),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_departments_parent').on(t.parentId),
  index('idx_departments_ancestors').on(t.ancestors),
]);
