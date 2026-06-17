/**
 * 数据库表类型集中导出
 *
 * 使用 Drizzle ORM 的 table.$inferSelect / table.$inferInsert
 * 从 schema 自动推断所有表的 Select（读取）和 Insert（写入）类型。
 *
 * ⚠️ 枚举类型统一从 @auth-sso/contracts 导入，此为唯一真相源。
 *
 * @module db/types
 */
import * as schema from './schema';

// ============================================
// 核心用户表
// ============================================

export type User = typeof schema.users.$inferSelect;
export type NewUser = typeof schema.users.$inferInsert;

// ============================================
// OIDC 核心表
// ============================================

export type Client = typeof schema.clients.$inferSelect;
export type NewClient = typeof schema.clients.$inferInsert;

export type AuthorizationCode = typeof schema.authorizationCodes.$inferSelect;
export type NewAuthorizationCode = typeof schema.authorizationCodes.$inferInsert;

export type AccessToken = typeof schema.accessTokens.$inferSelect;
export type NewAccessToken = typeof schema.accessTokens.$inferInsert;

export type RefreshToken = typeof schema.refreshTokens.$inferSelect;
export type NewRefreshToken = typeof schema.refreshTokens.$inferInsert;

export type Consent = typeof schema.consents.$inferSelect;
export type NewConsent = typeof schema.consents.$inferInsert;

export type JWK = typeof schema.jwks.$inferSelect;
export type NewJWK = typeof schema.jwks.$inferInsert;

// ============================================
// 业务管理表
// ============================================

export type Department = typeof schema.departments.$inferSelect;
export type NewDepartment = typeof schema.departments.$inferInsert;

export type Role = typeof schema.roles.$inferSelect;
export type NewRole = typeof schema.roles.$inferInsert;

export type Permission = typeof schema.permissions.$inferSelect;
export type NewPermission = typeof schema.permissions.$inferInsert;

export type UserRole = typeof schema.userRoles.$inferSelect;
export type NewUserRole = typeof schema.userRoles.$inferInsert;

export type RolePermission = typeof schema.rolePermissions.$inferSelect;
export type NewRolePermission = typeof schema.rolePermissions.$inferInsert;

export type RoleDataScope = typeof schema.roleDataScopes.$inferSelect;
export type NewRoleDataScope = typeof schema.roleDataScopes.$inferInsert;

export type RoleClient = typeof schema.roleClients.$inferSelect;
export type NewRoleClient = typeof schema.roleClients.$inferInsert;

// ============================================
// 日志表
// ============================================

export type AuditLog = typeof schema.auditLogs.$inferSelect;
export type NewAuditLog = typeof schema.auditLogs.$inferInsert;

export type LoginLog = typeof schema.loginLogs.$inferSelect;
export type NewLoginLog = typeof schema.loginLogs.$inferInsert;

// ============================================
// UI 表
// ============================================

export type Menu = typeof schema.menus.$inferSelect;
export type NewMenu = typeof schema.menus.$inferInsert;
