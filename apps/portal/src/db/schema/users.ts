/**
 * 用户领域表 (User Domain Tables)
 *
 * - users：核心用户主表
 * - userRoles：用户↔角色 多对多关联
 *
 * @module db/schema/users
 */
import { pgTable, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { userStatusEnum } from './enums';
import { roles } from './rbac';
import { departments } from './org';
import { updatedAtColumn } from './helpers';

/**
 * 核心用户表
 */
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
  deptId: text('dept_id').references(() => departments.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: updatedAtColumn(),
  lastLoginAt: timestamp('last_login_at'),
}, (t) => [
  // 软删除（status='DELETED'）的行不进索引：列表查询恒带 status != 'DELETED'，
  // 部分索引更省空间且命中更精准（Postgres: status='ACTIVE' 蕴含 status!='DELETED'，可命中此索引）。
  // 注意：部分索引谓词禁止参数化，必须用 sql 模板内联字面量（ne() 会生成 $1 占位符导致迁移失败）。
  index('idx_users_status').on(t.status).where(sql`${t.status} <> 'DELETED'`),
  index('idx_users_dept').on(t.deptId),
]);

/**
 * 用户↔角色 关联表
 */
export const userRoles = pgTable('user_roles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('idx_user_roles_user').on(t.userId),
  roleIdx: index('idx_user_roles_role').on(t.roleId),
  // DB 层拦截同一用户重复分配同一角色（数据完整性）
  uniqUserRole: uniqueIndex('ux_user_roles_user_role').on(t.userId, t.roleId),
}));
