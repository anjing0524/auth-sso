/**
 * Drizzle Relations 声明 (Relations API)
 *
 * 启用 db.query.<table>.findMany({ with: {...} }) 声明式关系查询，
 * 替代部分手写 innerJoin/leftJoin。仅声明常用关系，复杂报表查询仍用 join。
 *
 * v2 变更：
 * - 移除 menus、consents 关系
 * - 关联表改用复合主键（无代理 id），relations 中不再引用 id 列
 * - 所有 FK 统一引用 clients.client_id
 *
 * @module db/schema/relations
 */
import { relations } from 'drizzle-orm';
import { users, userRoles } from './users';
import { clients, accessTokens, refreshTokens, authorizationCodes } from './auth';
import { roles, permissions, rolePermissions } from './rbac';
import { departments } from './org';

/** 用户 ↔ 角色（多对多，经 user_roles）/ 部门 */
export const usersRelations = relations(users, ({ many, one }) => ({
  userRoles: many(userRoles),
  department: one(departments, { fields: [users.deptId], references: [departments.id] }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

/** 角色 ↔ 权限 / 用户 / 所属部门 */
export const rolesRelations = relations(roles, ({ many, one }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
  department: one(departments, { fields: [roles.deptId], references: [departments.id] }),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));

/** 权限统一树：自引用父子关系 + 角色关联 + Client 关联 */
export const permissionsRelations = relations(permissions, ({ one, many }) => ({
  parent: one(permissions, { fields: [permissions.parentId], references: [permissions.id], relationName: 'permission_parent' }),
  children: many(permissions, { relationName: 'permission_parent' }),
  rolePermissions: many(rolePermissions),
  client: one(clients, { fields: [permissions.clientId], references: [clients.clientId] }),
}));

/** Client ↔ Token / 授权码 / 权限（统一引用 client_id） */
export const clientsRelations = relations(clients, ({ many }) => ({
  accessTokens: many(accessTokens),
  refreshTokens: many(refreshTokens),
  authorizationCodes: many(authorizationCodes),
  permissions: many(permissions),
}));

export const accessTokensRelations = relations(accessTokens, ({ one }) => ({
  client: one(clients, { fields: [accessTokens.clientId], references: [clients.clientId] }),
  user: one(users, { fields: [accessTokens.userId], references: [users.id] }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const authorizationCodesRelations = relations(authorizationCodes, ({ one }) => ({
  client: one(clients, { fields: [authorizationCodes.clientId], references: [clients.clientId] }),
  user: one(users, { fields: [authorizationCodes.userId], references: [users.id] }),
}));

/** 部门自引用父子关系 */
export const departmentsRelations = relations(departments, ({ one, many }) => ({
  parent: one(departments, { fields: [departments.parentId], references: [departments.id], relationName: 'department_parent' }),
  children: many(departments, { relationName: 'department_parent' }),
}));
