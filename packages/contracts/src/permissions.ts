/**
 * Auth-SSO 权限码定义
 * @module @auth-sso/contracts/permissions
 */

// 权限码命名规范：
// - 格式：portal:{资源}:{动作}
// - 资源：小写，使用下划线分隔
// - 动作：list | create | read | update | delete | manage
// - list = 查询列表；read = 查询单条详情

// ========== 用户管理权限 ==========
export const USER_PERMISSIONS = {
  LIST: 'portal:user:list',
  CREATE: 'portal:user:create',
  READ: 'portal:user:read',
  UPDATE: 'portal:user:update',
  DELETE: 'portal:user:delete',
  MANAGE: 'portal:user:manage',
  RESET_PASSWORD: 'portal:user:reset_password',
  ASSIGN_ROLE: 'portal:user:assign_role',
} as const;

// ========== 部门管理权限 ==========
export const DEPARTMENT_PERMISSIONS = {
  LIST: 'portal:department:list',
  CREATE: 'portal:department:create',
  READ: 'portal:department:read',
  UPDATE: 'portal:department:update',
  DELETE: 'portal:department:delete',
  MANAGE: 'portal:department:manage',
} as const;

// ========== 角色管理权限 ==========
export const ROLE_PERMISSIONS = {
  LIST: 'portal:role:list',
  CREATE: 'portal:role:create',
  READ: 'portal:role:read',
  UPDATE: 'portal:role:update',
  DELETE: 'portal:role:delete',
  MANAGE: 'portal:role:manage',
  ASSIGN_PERMISSION: 'portal:role:assign_permission',
} as const;

// ========== 权限管理权限 ==========
export const PERMISSION_PERMISSIONS = {
  LIST: 'portal:permission:list',
  CREATE: 'portal:permission:create',
  READ: 'portal:permission:read',
  UPDATE: 'portal:permission:update',
  DELETE: 'portal:permission:delete',
  MANAGE: 'portal:permission:manage',
} as const;

// ========== Client 管理权限 ==========
export const CLIENT_PERMISSIONS = {
  LIST: 'portal:client:list',
  CREATE: 'portal:client:create',
  READ: 'portal:client:read',
  UPDATE: 'portal:client:update',
  DELETE: 'portal:client:delete',
  MANAGE: 'portal:client:manage',
  ROTATE_SECRET: 'portal:client:rotate_secret',
} as const;

// ========== 审计日志权限 ==========
export const AUDIT_PERMISSIONS = {
  READ: 'portal:audit:read',
  EXPORT: 'portal:audit:export',
} as const;

// ========== 登录日志权限 ==========
export const LOGIN_LOG_PERMISSIONS = {
  READ: 'portal:login_log:read',
  EXPORT: 'portal:login_log:export',
} as const;

// ========== 系统管理权限 ==========
export const SYSTEM_PERMISSIONS = {
  MANAGE: 'portal:system:manage',
  VIEW_DASHBOARD: 'portal:system:view_dashboard',
} as const;

/** Portal 首页菜单权限；菜单本身也是权限树中的受控节点。 */
export const PORTAL_MENU_PERMISSIONS = {
  DASHBOARD: 'portal:menu:dashboard',
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
  ...Object.values(PORTAL_MENU_PERMISSIONS),
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
  PORTAL_MENU: { name: '门户菜单', permissions: Object.values(PORTAL_MENU_PERMISSIONS) },
} as const;

// 权限中文名映射（seed 脚本使用）
export const PERMISSION_LABELS: Record<string, string> = {
  'portal:user:list': '查看用户列表',
  'portal:user:create': '创建用户',
  'portal:user:read': '查看用户详情',
  'portal:user:update': '修改用户',
  'portal:user:delete': '删除用户',
  'portal:user:manage': '用户管理',
  'portal:user:reset_password': '重置密码',
  'portal:user:assign_role': '分配角色',
  'portal:department:list': '查看部门列表',
  'portal:department:create': '创建部门',
  'portal:department:read': '查看部门详情',
  'portal:department:update': '修改部门',
  'portal:department:delete': '删除部门',
  'portal:department:manage': '部门管理',
  'portal:role:list': '查看角色列表',
  'portal:role:create': '创建角色',
  'portal:role:read': '查看角色详情',
  'portal:role:update': '修改角色',
  'portal:role:delete': '删除角色',
  'portal:role:manage': '角色管理',
  'portal:role:assign_permission': '分配权限',
  'portal:permission:list': '查看权限列表',
  'portal:permission:create': '创建权限',
  'portal:permission:read': '查看权限详情',
  'portal:permission:update': '修改权限',
  'portal:permission:delete': '删除权限',
  'portal:permission:manage': '权限管理',
  'portal:client:list': '查看应用列表',
  'portal:client:create': '创建应用',
  'portal:client:read': '查看应用详情',
  'portal:client:update': '修改应用',
  'portal:client:delete': '删除应用',
  'portal:client:manage': '应用管理',
  'portal:client:rotate_secret': '轮换密钥',
  'portal:audit:read': '查看审计日志',
  'portal:audit:export': '导出审计日志',
  'portal:login_log:read': '查看登录日志',
  'portal:login_log:export': '导出登录日志',
  'portal:system:manage': '系统管理',
  'portal:system:view_dashboard': '查看仪表盘',
  'portal:menu:dashboard': '查看首页',
};
