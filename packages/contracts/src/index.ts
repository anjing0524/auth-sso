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

// 权限类型 — 唯一真相源（合并旧 permission_type + menu_type，menus 表已合并进 permissions）
export const PERMISSION_TYPE_VALUES = ['DIRECTORY', 'PAGE', 'API', 'DATA'] as const;
export type PermissionType = typeof PERMISSION_TYPE_VALUES[number];

// Client 类型 — 唯一真相源值数组
export const CLIENT_TYPE_VALUES = ['confidential', 'public'] as const;
export type ClientType = typeof CLIENT_TYPE_VALUES[number];

// Grant Type
export type GrantType = 'authorization_code' | 'refresh_token';

// OIDC Scope
export type OIDCScope = 'openid' | 'profile' | 'email' | 'offline_access';

// Token 类型
export type TokenType = 'Bearer';

// 登录事件类型 — 唯一真相源
export const LOGIN_EVENT_VALUES = ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESH', 'TOKEN_REFRESH_FAILED'] as const;
export type LoginEventType = typeof LOGIN_EVENT_VALUES[number];

// 登录事件中英文标签
export const LOGIN_EVENT_LABELS: Record<LoginEventType, string> = {
  LOGIN_SUCCESS: '登录成功',
  LOGIN_FAILED: '登录失败',
  LOGOUT: '登出',
  TOKEN_REFRESH: 'Token刷新',
  TOKEN_REFRESH_FAILED: 'Token刷新失败',
};

// ────────────────────────────────────────────
// 枚举默认值常量（domain 工厂函数使用，消除手写字符串字面量）
// 所有枚举值的单一真相源仍在 *_VALUES 数组中
// ────────────────────────────────────────────
export const USER_ACTIVE: UserStatus = 'ACTIVE';
export const USER_DISABLED: UserStatus = 'DISABLED';
export const USER_LOCKED: UserStatus = 'LOCKED';
export const USER_DELETED: UserStatus = 'DELETED';
export const ENTITY_ACTIVE: EntityStatus = 'ACTIVE';
export const ENTITY_DISABLED: EntityStatus = 'DISABLED';
export const PERMISSION_API: PermissionType = 'API';
export const PERMISSION_PAGE: PermissionType = 'PAGE';
export const PERMISSION_DIRECTORY: PermissionType = 'DIRECTORY';
export const PERMISSION_DATA: PermissionType = 'DATA';
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

// Cookie 名称 — Portal 与 Gateway 共享的 HttpOnly Cookie Key
export const COOKIE_NAMES = {
  /** Access Token (ES256 JWT)，Gateway 从此 Cookie 提取并验签 */
  JWT: 'portal_jwt_token',
  /** OAuth 2.1 Refresh Token，仅在 Portal BFF 内部读写 */
  REFRESH: 'portal_refresh_token',
  /** 登录后临时会话 Token (5min TTL)，仅含 sub */
  LOGIN_SESSION: 'login_session',
} as const;

// Gateway 注入的请求头名称
export const GATEWAY_HEADERS = {
  /** Gateway 验签后注入的用户 ID header（Portal 信任路径免验签） */
  USER_ID: 'x-user-id',
  /** Gateway 验签后注入的 JWT 唯一标识 jti header */
  USER_JTI: 'x-user-jti',
} as const;

// 审计操作类型 — 唯一真相源
export const AUDIT_OPERATION_VALUES = [
  'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'USER_ROLE_ASSIGN',
  'ROLE_CREATE', 'ROLE_UPDATE', 'ROLE_DELETE', 'ROLE_PERMISSION_ASSIGN',
  'PERMISSION_CREATE', 'PERMISSION_UPDATE', 'PERMISSION_DELETE',
  'DEPARTMENT_CREATE', 'DEPARTMENT_UPDATE', 'DEPARTMENT_DELETE',
  'CLIENT_CREATE', 'CLIENT_UPDATE', 'CLIENT_DELETE', 'CLIENT_SECRET_REGENERATE',
  'TOKEN_REVOKE',
] as const;
export type AuditOperation = typeof AUDIT_OPERATION_VALUES[number];

// 审计操作中英文标签
export const AUDIT_OPERATION_LABELS: Record<AuditOperation, string> = {
  USER_CREATE: '创建用户',
  USER_UPDATE: '更新用户',
  USER_DELETE: '删除用户',
  USER_ROLE_ASSIGN: '分配角色',
  ROLE_CREATE: '创建角色',
  ROLE_UPDATE: '更新角色',
  ROLE_DELETE: '删除角色',
  ROLE_PERMISSION_ASSIGN: '分配权限',
  PERMISSION_CREATE: '创建权限',
  PERMISSION_UPDATE: '更新权限',
  PERMISSION_DELETE: '删除权限',
  DEPARTMENT_CREATE: '创建部门',
  DEPARTMENT_UPDATE: '更新部门',
  DEPARTMENT_DELETE: '删除部门',
  CLIENT_CREATE: '创建Client',
  CLIENT_UPDATE: '更新Client',
  CLIENT_DELETE: '删除Client',
  CLIENT_SECRET_REGENERATE: '重置Secret',
  TOKEN_REVOKE: '撤销Token',
};

// 用户权限上下文（由 Portal lib/permissions.ts 查询 DB/Redis 后填充）
export interface UserPermissionContext {
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
  /** 用户所有角色所属部门（含子树展开）的 ID 列表 */
  deptIds: string[];
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