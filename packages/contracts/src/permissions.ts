/**
 * Auth-SSO 权限码定义
 * @module @auth-sso/contracts/permissions
 */

// 权限码命名规范：
// - 格式：{资源}:{动作}
// - 资源：小写，使用下划线分隔
// - 动作：create | read | update | delete | manage

// ========== 用户管理权限 ==========
export const USER_PERMISSIONS = {
  CREATE: 'user:create',
  READ: 'user:read',
  UPDATE: 'user:update',
  DELETE: 'user:delete',
  MANAGE: 'user:manage',      // 包含所有用户管理权限
  RESET_PASSWORD: 'user:reset_password',
  ASSIGN_ROLE: 'user:assign_role',
} as const;

// ========== 部门管理权限 ==========
export const DEPARTMENT_PERMISSIONS = {
  CREATE: 'department:create',
  READ: 'department:read',
  UPDATE: 'department:update',
  DELETE: 'department:delete',
  MANAGE: 'department:manage',
} as const;

// ========== 角色管理权限 ==========
export const ROLE_PERMISSIONS = {
  CREATE: 'role:create',
  READ: 'role:read',
  UPDATE: 'role:update',
  DELETE: 'role:delete',
  MANAGE: 'role:manage',
  ASSIGN_PERMISSION: 'role:assign_permission',
} as const;

// ========== 权限管理权限 ==========
export const PERMISSION_PERMISSIONS = {
  CREATE: 'permission:create',
  READ: 'permission:read',
  UPDATE: 'permission:update',
  DELETE: 'permission:delete',
  MANAGE: 'permission:manage',
} as const;

// ========== 菜单管理权限 ==========
export const MENU_PERMISSIONS = {
  CREATE: 'menu:create',
  READ: 'menu:read',
  UPDATE: 'menu:update',
  DELETE: 'menu:delete',
  MANAGE: 'menu:manage',
} as const;

// ========== Client 管理权限 ==========
export const CLIENT_PERMISSIONS = {
  CREATE: 'client:create',
  READ: 'client:read',
  UPDATE: 'client:update',
  DELETE: 'client:delete',
  MANAGE: 'client:manage',
  ROTATE_SECRET: 'client:rotate_secret',
} as const;

// ========== 审计日志权限 ==========
export const AUDIT_PERMISSIONS = {
  READ: 'audit:read',
  EXPORT: 'audit:export',
} as const;

// ========== 登录日志权限 ==========
export const LOGIN_LOG_PERMISSIONS = {
  READ: 'login_log:read',
  EXPORT: 'login_log:export',
} as const;

// ========== 系统管理权限 ==========
export const SYSTEM_PERMISSIONS = {
  MANAGE: 'system:manage',
  VIEW_DASHBOARD: 'system:view_dashboard',
} as const;

// 所有权限码列表
export const ALL_PERMISSIONS = [
  ...Object.values(USER_PERMISSIONS),
  ...Object.values(DEPARTMENT_PERMISSIONS),
  ...Object.values(ROLE_PERMISSIONS),
  ...Object.values(PERMISSION_PERMISSIONS),
  ...Object.values(MENU_PERMISSIONS),
  ...Object.values(CLIENT_PERMISSIONS),
  ...Object.values(AUDIT_PERMISSIONS),
  ...Object.values(LOGIN_LOG_PERMISSIONS),
  ...Object.values(SYSTEM_PERMISSIONS),
] as const;

// 权限分组
export const PERMISSION_GROUPS = {
  USER: {
    name: '用户管理',
    permissions: Object.values(USER_PERMISSIONS),
  },
  DEPARTMENT: {
    name: '部门管理',
    permissions: Object.values(DEPARTMENT_PERMISSIONS),
  },
  ROLE: {
    name: '角色管理',
    permissions: Object.values(ROLE_PERMISSIONS),
  },
  PERMISSION: {
    name: '权限管理',
    permissions: Object.values(PERMISSION_PERMISSIONS),
  },
  MENU: {
    name: '菜单管理',
    permissions: Object.values(MENU_PERMISSIONS),
  },
  CLIENT: {
    name: 'Client 管理',
    permissions: Object.values(CLIENT_PERMISSIONS),
  },
  AUDIT: {
    name: '审计日志',
    permissions: Object.values(AUDIT_PERMISSIONS),
  },
  LOGIN_LOG: {
    name: '登录日志',
    permissions: Object.values(LOGIN_LOG_PERMISSIONS),
  },
  SYSTEM: {
    name: '系统管理',
    permissions: Object.values(SYSTEM_PERMISSIONS),
  },
} as const;