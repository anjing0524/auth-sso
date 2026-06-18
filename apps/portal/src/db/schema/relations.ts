/**
 * Drizzle Relations 声明 (Relations API)
 *
 * 启用 db.query.<table>.findMany({ with: {...} }) 声明式关系查询，
 * 替代部分手写 innerJoin/leftJoin。仅声明常用关系，复杂报表查询仍用 join。
 *
 * @module db/schema/relations
 */
import { relations } from 'drizzle-orm';
import { users, userRoles } from './users';
import { clients, accessTokens, refreshTokens, consents, authorizationCodes } from './auth';
import { roles, permissions, rolePermissions, roleDataScopes, roleClients } from './rbac';
import { departments, menus } from './org';

/** 用户 ↔ 角色（多对多，经 user_roles）/ 部门 */
export const usersRelations = relations(users, ({ many, one }) => ({
  userRoles: many(userRoles),
  department: one(departments, { fields: [users.deptId], references: [departments.id] }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

/** 角色 ↔ 权限 / 数据范围 / Client / 用户（多对多） */
export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
  roleDataScopes: many(roleDataScopes),
  roleClients: many(roleClients),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));

export const roleDataScopesRelations = relations(roleDataScopes, ({ one }) => ({
  role: one(roles, { fields: [roleDataScopes.roleId], references: [roles.id] }),
  department: one(departments, { fields: [roleDataScopes.deptId], references: [departments.id] }),
}));

export const roleClientsRelations = relations(roleClients, ({ one }) => ({
  role: one(roles, { fields: [roleClients.roleId], references: [roles.id] }),
  client: one(clients, { fields: [roleClients.clientId], references: [clients.clientId] }),
}));

/** 权限自引用父子关系 */
export const permissionsRelations = relations(permissions, ({ one, many }) => ({
  parent: one(permissions, { fields: [permissions.parentId], references: [permissions.id], relationName: 'permission_parent' }),
  children: many(permissions, { relationName: 'permission_parent' }),
  rolePermissions: many(rolePermissions),
}));

/** Client ↔ Token / Consent / 授权码 */
export const clientsRelations = relations(clients, ({ many }) => ({
  accessTokens: many(accessTokens),
  refreshTokens: many(refreshTokens),
  consents: many(consents),
  authorizationCodes: many(authorizationCodes),
  roleClients: many(roleClients),
}));

export const accessTokensRelations = relations(accessTokens, ({ one }) => ({
  client: one(clients, { fields: [accessTokens.clientId], references: [clients.id] }),
  user: one(users, { fields: [accessTokens.userId], references: [users.id] }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  client: one(clients, { fields: [refreshTokens.clientId], references: [clients.id] }),
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const consentsRelations = relations(consents, ({ one }) => ({
  client: one(clients, { fields: [consents.clientId], references: [clients.id] }),
  user: one(users, { fields: [consents.userId], references: [users.id] }),
}));

export const authorizationCodesRelations = relations(authorizationCodes, ({ one }) => ({
  client: one(clients, { fields: [authorizationCodes.clientId], references: [clients.id] }),
  user: one(users, { fields: [authorizationCodes.userId], references: [users.id] }),
}));

/** 部门自引用父子关系 */
export const departmentsRelations = relations(departments, ({ one, many }) => ({
  parent: one(departments, { fields: [departments.parentId], references: [departments.id], relationName: 'department_parent' }),
  children: many(departments, { relationName: 'department_parent' }),
  roleDataScopes: many(roleDataScopes),
}));

/** 菜单自引用父子关系 */
export const menusRelations = relations(menus, ({ one, many }) => ({
  parent: one(menus, { fields: [menus.parentId], references: [menus.id], relationName: 'menu_parent' }),
  children: many(menus, { relationName: 'menu_parent' }),
}));
