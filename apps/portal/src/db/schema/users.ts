/**
 * 用户领域表 (User Domain Tables)
 *
 * - users：核心用户主表
 * - userRoles：用户↔角色 多对多关联
 *
 * @module db/schema/users
 */
import { pgTable, text, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { userStatusEnum } from './enums';
import { roles } from './rbac';
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
  deptId: text('dept_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: updatedAtColumn(),
  lastLoginAt: timestamp('last_login_at'),
}, (t) => [
  // 数据范围过滤与状态筛选的高频列索引
  index('idx_users_status').on(t.status),
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
}));
