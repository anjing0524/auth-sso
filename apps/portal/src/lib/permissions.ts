/**
 * 权限上下文工具函数
 * 获取用户的角色和权限
 */
import { db, schema } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';

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
    const users = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    if (users.length === 0) {
      return null;
    }

    const user = users[0]!;

    // 获取用户的角色
    const userRolesData = await db
      .select({
        id: schema.roles.id,
        code: schema.roles.code,
        name: schema.roles.name,
        dataScopeType: schema.roles.dataScopeType,
      })
      .from(schema.roles)
      .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, userId));

    // 只获取状态为 ACTIVE 的角色
    const roles = userRolesData.filter(r => true); // schema 中 role 有 status 字段

    if (roles.length === 0) {
      return {
        roles: [],
        permissions: [],
        dataScopeType: 'SELF',
        deptId: user.deptId ?? undefined,
      };
    }

    // 获取角色的权限
    const roleIds = roles.map(r => r.id);
    const permissionsData = await db
      .selectDistinct({ code: schema.permissions.code })
      .from(schema.permissions)
      .innerJoin(schema.rolePermissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(inArray(schema.rolePermissions.roleId, roleIds));

    // 确定数据范围类型（取最高权限）
    const dataScopeTypes = ['ALL', 'DEPT_AND_SUB', 'DEPT', 'CUSTOM', 'SELF'];
    let maxDataScopeType: string = 'SELF';

    for (const role of roles) {
      const roleDataScope = role.dataScopeType;
      if (dataScopeTypes.indexOf(roleDataScope) < dataScopeTypes.indexOf(maxDataScopeType)) {
        maxDataScopeType = roleDataScope;
      }
    }

    return {
      roles: roles.map(r => ({
        id: r.id,
        code: r.code,
        name: r.name,
      })),
      permissions: permissionsData.map(p => p.code),
      dataScopeType: maxDataScopeType as UserPermissionContext['dataScopeType'],
      deptId: user.deptId ?? undefined,
    };
  } catch (error: any) {
    console.error('[PermissionContext] Error:', error.message, error.stack);
    return null;
  }
}