/**
 * Auth-SSO 共享类型定义
 * @module @auth-sso/contracts
 */

// 用户状态唯一真相源值数组
export const USER_STATUS_VALUES = ['ACTIVE', 'DISABLED', 'LOCKED', 'DELETED'] as const;
export type UserStatus = typeof USER_STATUS_VALUES[number];

// 部门/角色/权限/菜单/Client 状态唯一真相源值数组
export const ENTITY_STATUS_VALUES = ['ACTIVE', 'DISABLED'] as const;
export type EntityStatus = typeof ENTITY_STATUS_VALUES[number];

// 数据范围类型 — 唯一真相源
export const DATA_SCOPE_TYPE_VALUES = ['ALL', 'DEPT', 'DEPT_AND_SUB', 'SELF', 'CUSTOM'] as const;
export type DataScopeType = typeof DATA_SCOPE_TYPE_VALUES[number];

// 权限类型 — 唯一真相源
export const PERMISSION_TYPE_VALUES = ['MENU', 'API', 'DATA'] as const;
export type PermissionType = typeof PERMISSION_TYPE_VALUES[number];

// 菜单类型 — 唯一真相源
export const MENU_TYPE_VALUES = ['DIRECTORY', 'MENU', 'BUTTON'] as const;
export type MenuType = typeof MENU_TYPE_VALUES[number];

// Client 类型 — 唯一真相源值数组
export const CLIENT_TYPE_VALUES = ['confidential', 'public'] as const;
export type ClientType = typeof CLIENT_TYPE_VALUES[number];

// Grant Type
export type GrantType = 'authorization_code' | 'refresh_token';

// OIDC Scope
export type OIDCScope = 'openid' | 'profile' | 'email' | 'offline_access';

// Token 类型
export type TokenType = 'Bearer';

// 登录事件类型
export type LoginEventType = 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGOUT';

// ────────────────────────────────────────────
// 枚举默认值常量（domain 工厂函数使用，消除手写字符串字面量）
// 所有枚举值的单一真相源仍在 *_VALUES 数组中
// ────────────────────────────────────────────
export const USER_ACTIVE: UserStatus = 'ACTIVE';
export const USER_DELETED: UserStatus = 'DELETED';
export const ENTITY_ACTIVE: EntityStatus = 'ACTIVE';
export const ENTITY_DISABLED: EntityStatus = 'DISABLED';
export const DATA_SCOPE_SELF: DataScopeType = 'SELF';
export const PERMISSION_API: PermissionType = 'API';
export const MENU_TYPE_MENU: MenuType = 'MENU';
/** 系统管理员角色编码集合（硬编码业务常量） */
export const ADMIN_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN'] as const;

// 外部 ID 前缀（与 domain 工厂函数保持一致）
export const PUBLIC_ID_PREFIX = {
  USER: 'user_',
  DEPARTMENT: 'dept_',
  ROLE: 'role_',
  PERMISSION: 'perm_',
  MENU: 'menu_',
  CLIENT: 'cli_',
} as const;

// 用户权限上下文（由 Portal lib/permissions.ts 查询 DB/Redis 后填充）
export interface UserPermissionContext {
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
  dataScopeType: DataScopeType;
  deptId?: string;
}

// API 响应类型契约 (Controller 层统一返回格式)
type ApiSuccess<T> = {
  success: true;
  data: T;
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  message?: string;
};

type ApiError = {
  success: false;
  error: string;
  message: string;
};

/** 统一 API 响应类型 — Controller 层唯一返回值契约 */
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// 导出所有类型
export * from './errors';
export * from './permissions';
export * from './oidc';