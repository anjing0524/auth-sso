/**
 * 用户领域表 (User Domain Tables)
 *
 * - users：核心用户主表（uuid PK，varchar 类型，timestamptz）
 * - userRoles：用户↔角色 多对多关联（复合主键）
 *
 * v2 变更：
 * - PK 类型 text → uuid，默认 gen_random_uuid()
 * - 业务列 text → varchar(n) 加长度约束
 * - timestamp → timestamptz
 * - 新增 deleted_at（US-B-11 要求）和 password_changed_at（US-SEC-02 要求）
 * - 移除 public_id（冗余双主键）
 * - user_roles 改为复合主键 (user_id, role_id)
 *
 * @module db/schema/users
 */
import { pgTable, uuid, varchar, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { userStatusEnum } from './enums';
import { roles } from './rbac';
import { departments } from './org';
import { createdAtColumn, updatedAtColumn } from './helpers';

/**
 * 核心用户表
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  email: varchar('email', { length: 255 }).unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  mobile: varchar('mobile', { length: 20 }).unique(),
  mobileVerified: boolean('mobile_verified').notNull().default(false),
  passwordHash: varchar('password_hash', { length: 128 }),
  name: varchar('name', { length: 100 }).notNull(),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  status: userStatusEnum('status').notNull().default('ACTIVE'),
  deptId: uuid('dept_id').references(() => departments.id, { onDelete: 'set null' }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_users_status').on(t.status).where(sql`${t.status} <> 'DELETED'`),
  index('idx_users_dept').on(t.deptId),
  index('idx_users_deleted_at').on(t.deletedAt),
]);

/**
 * 用户↔角色 关联表（复合主键，无代理 id）
 */
export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: createdAtColumn(),
}, (t) => [
  uniqueIndex('ux_user_roles_pk').on(t.userId, t.roleId),  // 复合主键（唯一索引即主键）
  index('idx_user_roles_role').on(t.roleId),
]);
