/**
 * Customer Graph 数据库连接
 * 共享 IdP/Portal 的数据库
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import {
  pgTable,
  text,
  timestamp,
  boolean,
  pgEnum,
  integer,
} from 'drizzle-orm/pg-core';

// ============================================
// 枚举定义 (从 IdP schema 同步)
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

// ============================================
// 核心 Schema (仅包含 Customer Graph 需要的表)
// ============================================

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  email: text('email').unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  status: userStatusEnum('status').notNull().default('ACTIVE'),
  deptId: text('dept_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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
// 数据库连接（延迟初始化）
// ============================================

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * 获取数据库实例
 * 延迟初始化，避免构建时报错
 */
function getDbInstance() {
  if (!_db) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    const sql = neon(connectionString);
    _db = drizzle({ client: sql, schema: {
      users,
      departments,
      roles,
      permissions,
      userRoles,
      rolePermissions,
      roleDataScopes,
    } });
  }
  return _db;
}

// 导出 db 作为 getter，保持 API 兼容
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const instance = getDbInstance();
    return Reflect.get(instance, prop, instance);
  },
});

export const schema = {
  users,
  departments,
  roles,
  permissions,
  userRoles,
  rolePermissions,
  roleDataScopes,
};

// ============================================
// 类型导出
// ============================================

export type User = typeof users.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;