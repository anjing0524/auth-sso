/**
 * 数据库表类型集中导出
 *
 * 使用 Drizzle ORM 的 table.$inferSelect / table.$inferInsert
 * 从 schema 自动推断所有表的 Select（读取）和 Insert（写入）类型。
 *
 * ⚠️ 枚举类型（UserStatus / DataScopeType / EntityStatus 等）统一从 @auth-sso/contracts 导入，
 *    此为唯一真相源，不在本文件中重复导出。
 *
 * @module db/types
 */
import * as schema from './schema';

// ============================================
// 用户核心表
// ============================================

/** 用户表 — Select 类型（从 DB 读出的行） */
export type User = typeof schema.users.$inferSelect;
/** 用户表 — Insert 类型（写入 DB 的参数） */
export type NewUser = typeof schema.users.$inferInsert;

// ============================================
// Better Auth 兼容表
// ============================================

/** 会话表 — Select 类型 */
export type Session = typeof schema.sessions.$inferSelect;
/** 会话表 — Insert 类型 */
export type NewSession = typeof schema.sessions.$inferInsert;

/** 账号表 — Select 类型 */
export type Account = typeof schema.accounts.$inferSelect;
/** 账号表 — Insert 类型 */
export type NewAccount = typeof schema.accounts.$inferInsert;

/** 验证表 — Select 类型 */
export type Verification = typeof schema.verifications.$inferSelect;
/** 验证表 — Insert 类型 */
export type NewVerification = typeof schema.verifications.$inferInsert;

// ============================================
// OIDC 核心表
// ============================================

/** OAuth 客户端 — Select 类型 */
export type Client = typeof schema.clients.$inferSelect;
/** OAuth 客户端 — Insert 类型 */
export type NewClient = typeof schema.clients.$inferInsert;

/** 授权码 — Select 类型 */
export type AuthorizationCode = typeof schema.authorizationCodes.$inferSelect;
/** 授权码 — Insert 类型 */
export type NewAuthorizationCode = typeof schema.authorizationCodes.$inferInsert;

/** OAuth Access Token — Select 类型 */
export type OAuthAccessToken = typeof schema.oauthAccessTokens.$inferSelect;
/** OAuth Access Token — Insert 类型 */
export type NewOAuthAccessToken = typeof schema.oauthAccessTokens.$inferInsert;

/** OAuth Refresh Token — Select 类型 */
export type OAuthRefreshToken = typeof schema.oauthRefreshTokens.$inferSelect;
/** OAuth Refresh Token — Insert 类型 */
export type NewOAuthRefreshToken = typeof schema.oauthRefreshTokens.$inferInsert;

/** OAuth 授权同意 — Select 类型 */
export type OAuthConsent = typeof schema.oauthConsent.$inferSelect;
/** OAuth 授权同意 — Insert 类型 */
export type NewOAuthConsent = typeof schema.oauthConsent.$inferInsert;

/** JWKS 密钥对 — Select 类型 */
export type JWK = typeof schema.jwks.$inferSelect;
/** JWKS 密钥对 — Insert 类型 */
export type NewJWK = typeof schema.jwks.$inferInsert;

// ============================================
// 业务管理表（Portal 专用）
// ============================================

/** 部门 — Select 类型 */
export type Department = typeof schema.departments.$inferSelect;
/** 部门 — Insert 类型 */
export type NewDepartment = typeof schema.departments.$inferInsert;

/** 角色 — Select 类型 */
export type Role = typeof schema.roles.$inferSelect;
/** 角色 — Insert 类型 */
export type NewRole = typeof schema.roles.$inferInsert;

/** 权限 — Select 类型 */
export type Permission = typeof schema.permissions.$inferSelect;
/** 权限 — Insert 类型 */
export type NewPermission = typeof schema.permissions.$inferInsert;

/** 用户-角色关联 — Select 类型 */
export type UserRole = typeof schema.userRoles.$inferSelect;
/** 用户-角色关联 — Insert 类型 */
export type NewUserRole = typeof schema.userRoles.$inferInsert;

/** 角色-权限关联 — Select 类型 */
export type RolePermission = typeof schema.rolePermissions.$inferSelect;
/** 角色-权限关联 — Insert 类型 */
export type NewRolePermission = typeof schema.rolePermissions.$inferInsert;

/** 角色数据范围 — Select 类型 */
export type RoleDataScope = typeof schema.roleDataScopes.$inferSelect;
/** 角色数据范围 — Insert 类型 */
export type NewRoleDataScope = typeof schema.roleDataScopes.$inferInsert;

/** 角色-客户端关联 — Select 类型 */
export type RoleClient = typeof schema.roleClients.$inferSelect;
/** 角色-客户端关联 — Insert 类型 */
export type NewRoleClient = typeof schema.roleClients.$inferInsert;

// ============================================
// 日志表
// ============================================

/** 审计日志 — Select 类型 */
export type AuditLog = typeof schema.auditLogs.$inferSelect;
/** 审计日志 — Insert 类型 */
export type NewAuditLog = typeof schema.auditLogs.$inferInsert;

/** 登录日志 — Select 类型 */
export type LoginLog = typeof schema.loginLogs.$inferSelect;
/** 登录日志 — Insert 类型 */
export type NewLoginLog = typeof schema.loginLogs.$inferInsert;

// ============================================
// UI 表
// ============================================

/** 菜单 — Select 类型 */
export type Menu = typeof schema.menus.$inferSelect;
/** 菜单 — Insert 类型 */
export type NewMenu = typeof schema.menus.$inferInsert;
