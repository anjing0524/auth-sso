/**
 * 权限上下文工具函数
 * 获取用户的角色和权限
 */
import { sql } from '@/lib/db';

export interface UserPermissionContext {
  roles: Array<{
    id: string;
    code: string;
    name: string;
  }>;
  permissions: string[]; // 权限编码列表
  dataScopeType: 'ALL' | 'DEPT' | 'DEPT_AND_SUB' | 'SELF' | 'CUSTOM';
  deptId?: string;
}

/**
 * 获取用户的权限上下文
 */
export async function getUserPermissionContext(userId: string): Promise<UserPermissionContext | null> {
  try {
    // 获取用户信息
    const users = await sql`
      SELECT id, dept_id FROM users WHERE id = ${userId}
    `;

    if (users.length === 0) {
      return null;
    }

    const user = users[0] as any;

    // 获取用户的角色
    const roles = await sql`
      SELECT r.id, r.code, r.name, r.data_scope_type
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ${userId} AND r.status = 'ACTIVE'
    `;

    if (roles.length === 0) {
      return {
        roles: [],
        permissions: [],
        dataScopeType: 'SELF',
        deptId: user.dept_id,
      };
    }

    // 获取角色的权限
    const roleIds = roles.map((r: any) => r.id);
    const permissions = await sql`
      SELECT DISTINCT p.code
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id IN ${sql(roleIds)} AND p.status = 'ACTIVE'
    `;

    // 确定数据范围类型（取最高权限）
    const dataScopeTypes = ['ALL', 'DEPT_AND_SUB', 'DEPT', 'CUSTOM', 'SELF'];
    let maxDataScopeType: string = 'SELF';

    for (const role of roles) {
      const roleDataScope = (role as any).data_scope_type;
      if (dataScopeTypes.indexOf(roleDataScope) < dataScopeTypes.indexOf(maxDataScopeType)) {
        maxDataScopeType = roleDataScope;
      }
    }

    return {
      roles: roles.map((r: any) => ({
        id: r.id,
        code: r.code,
        name: r.name,
      })),
      permissions: permissions.map((p: any) => p.code),
      dataScopeType: maxDataScopeType as UserPermissionContext['dataScopeType'],
      deptId: user.dept_id,
    };
  } catch (error) {
    console.error('[PermissionContext] Error:', error);
    return null;
  }
}

/**
 * 检查用户是否有指定权限
 */
export async function hasPermission(userId: string, permissionCode: string): Promise<boolean> {
  const context = await getUserPermissionContext(userId);
  if (!context) return false;
  return context.permissions.includes(permissionCode);
}

/**
 * 检查用户是否有指定角色
 */
export async function hasRole(userId: string, roleCode: string): Promise<boolean> {
  const context = await getUserPermissionContext(userId);
  if (!context) return false;
  return context.roles.some(r => r.code === roleCode);
}