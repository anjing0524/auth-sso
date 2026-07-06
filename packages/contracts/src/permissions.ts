/**
 * Auth-SSO 权限码定义
 * @module @auth-sso/contracts/permissions
 */

// 权限码命名规范：
// - 格式：{资源}:{动作}
// - 资源：小写，使用下划线分隔
// - 动作：list | create | read | update | delete | manage
// - list = 查询列表；read = 查询单条详情

// ========== 用户管理权限 ==========
export const USER_PERMISSIONS = {
  LIST: 'user:list',
  CREATE: 'user:create',
  READ: 'user:read',
  UPDATE: 'user:update',
  DELETE: 'user:delete',
  MANAGE: 'user:manage',
  RESET_PASSWORD: 'user:reset_password',
  ASSIGN_ROLE: 'user:assign_role',
} as const;

// ========== 部门管理权限 ==========
export const DEPARTMENT_PERMISSIONS = {
  LIST: 'department:list',
  CREATE: 'department:create',
  READ: 'department:read',
  UPDATE: 'department:update',
  DELETE: 'department:delete',
  MANAGE: 'department:manage',
} as const;

// ========== 角色管理权限 ==========
export const ROLE_PERMISSIONS = {
  LIST: 'role:list',
  CREATE: 'role:create',
  READ: 'role:read',
  UPDATE: 'role:update',
  DELETE: 'role:delete',
  MANAGE: 'role:manage',
  ASSIGN_PERMISSION: 'role:assign_permission',
} as const;

// ========== 权限管理权限 ==========
export const PERMISSION_PERMISSIONS = {
  LIST: 'permission:list',
  CREATE: 'permission:create',
  READ: 'permission:read',
  UPDATE: 'permission:update',
  DELETE: 'permission:delete',
  MANAGE: 'permission:manage',
} as const;

// ========== Client 管理权限 ==========
export const CLIENT_PERMISSIONS = {
  LIST: 'client:list',
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

// 所有权限码列表（用于 seed 脚本遍历）
// 注：MENU_PERMISSIONS / CUSTOMER_GRAPH_PERMISSIONS 已删除（无对应功能实现）
export const ALL_PERMISSIONS = [
  ...Object.values(USER_PERMISSIONS),
  ...Object.values(DEPARTMENT_PERMISSIONS),
  ...Object.values(ROLE_PERMISSIONS),
  ...Object.values(PERMISSION_PERMISSIONS),
  ...Object.values(CLIENT_PERMISSIONS),
  ...Object.values(AUDIT_PERMISSIONS),
  ...Object.values(LOGIN_LOG_PERMISSIONS),
  ...Object.values(SYSTEM_PERMISSIONS),
] as const;

// 权限分组（用于 UI 展示）
export const PERMISSION_GROUPS = {
  USER: { name: '用户管理', permissions: Object.values(USER_PERMISSIONS) },
  DEPARTMENT: { name: '部门管理', permissions: Object.values(DEPARTMENT_PERMISSIONS) },
  ROLE: { name: '角色管理', permissions: Object.values(ROLE_PERMISSIONS) },
  PERMISSION: { name: '权限管理', permissions: Object.values(PERMISSION_PERMISSIONS) },
  CLIENT: { name: 'Client 管理', permissions: Object.values(CLIENT_PERMISSIONS) },
  AUDIT: { name: '审计日志', permissions: Object.values(AUDIT_PERMISSIONS) },
  LOGIN_LOG: { name: '登录日志', permissions: Object.values(LOGIN_LOG_PERMISSIONS) },
  SYSTEM: { name: '系统管理', permissions: Object.values(SYSTEM_PERMISSIONS) },
} as const;

// 权限中文名映射（seed 脚本使用）
export const PERMISSION_LABELS: Record<string, string> = {
  'user:list': '查看用户列表',
  'user:create': '创建用户',
  'user:read': '查看用户详情',
  'user:update': '修改用户',
  'user:delete': '删除用户',
  'user:manage': '用户管理',
  'user:reset_password': '重置密码',
  'user:assign_role': '分配角色',
  'department:list': '查看部门列表',
  'department:create': '创建部门',
  'department:read': '查看部门详情',
  'department:update': '修改部门',
  'department:delete': '删除部门',
  'department:manage': '部门管理',
  'role:list': '查看角色列表',
  'role:create': '创建角色',
  'role:read': '查看角色详情',
  'role:update': '修改角色',
  'role:delete': '删除角色',
  'role:manage': '角色管理',
  'role:assign_permission': '分配权限',
  'permission:list': '查看权限列表',
  'permission:create': '创建权限',
  'permission:read': '查看权限详情',
  'permission:update': '修改权限',
  'permission:delete': '删除权限',
  'permission:manage': '权限管理',
  'client:list': '查看应用列表',
  'client:create': '创建应用',
  'client:read': '查看应用详情',
  'client:update': '修改应用',
  'client:delete': '删除应用',
  'client:manage': '应用管理',
  'client:rotate_secret': '轮换密钥',
  'audit:read': '查看审计日志',
  'audit:export': '导出审计日志',
  'login_log:read': '查看登录日志',
  'login_log:export': '导出登录日志',
  'system:manage': '系统管理',
  'system:view_dashboard': '查看仪表盘',
};
