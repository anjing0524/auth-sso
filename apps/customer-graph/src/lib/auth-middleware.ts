/**
 * 权限检查与数据范围过滤
 * 用于 API 路由中的权限验证
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionIdFromCookie } from './session';
import { db, schema } from '@/db';
import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';

/**
 * 权限检查选项
 */
export interface PermissionCheckOptions {
  /** 需要的权限编码列表（满足任一即可） */
  permissions?: string[];
  /** 需要的角色编码列表（满足任一即可） */
  roles?: string[];
  /** 是否要求所有权限 */
  requireAll?: boolean;
}

/**
 * 权限检查结果
 */
export interface PermissionCheckResult {
  authorized: boolean;
  userId?: string;
  error?: string;
  statusCode?: number;
}

/**
 * 用户权限上下文
 */
export interface UserPermissionContext {
  roles: Array<{
    id: string;
    code: string;
    name: string;
  }>;
  permissions: string[];
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

    if (userRolesData.length === 0) {
      return {
        roles: [],
        permissions: [],
        dataScopeType: 'SELF',
        deptId: user.deptId ?? undefined,
      };
    }

    // 获取角色的权限
    const roleIds = userRolesData.map(r => r.id);
    const permissionsData = await db
      .selectDistinct({ code: schema.permissions.code })
      .from(schema.permissions)
      .innerJoin(schema.rolePermissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(inArray(schema.rolePermissions.roleId, roleIds));

    // 确定数据范围类型（取最高权限）
    const dataScopeTypes = ['ALL', 'DEPT_AND_SUB', 'DEPT', 'CUSTOM', 'SELF'];
    let maxDataScopeType: string = 'SELF';

    for (const role of userRolesData) {
      const roleDataScope = role.dataScopeType;
      if (dataScopeTypes.indexOf(roleDataScope) < dataScopeTypes.indexOf(maxDataScopeType)) {
        maxDataScopeType = roleDataScope;
      }
    }

    return {
      roles: userRolesData.map(r => ({
        id: r.id,
        code: r.code,
        name: r.name,
      })),
      permissions: permissionsData.map(p => p.code),
      dataScopeType: maxDataScopeType as UserPermissionContext['dataScopeType'],
      deptId: user.deptId ?? undefined,
    };
  } catch (error) {
    console.error('[PermissionContext] Error:', error);
    return null;
  }
}

/**
 * 检查用户权限
 * 用于 API 路由中的权限验证
 */
export async function checkPermission(
  request: NextRequest,
  options: PermissionCheckOptions
): Promise<PermissionCheckResult> {
  try {
    // 1. 检查 Session
    const sessionId = await getSessionIdFromCookie();
    if (!sessionId) {
      return {
        authorized: false,
        error: '未登录',
        statusCode: 401,
      };
    }

    const session = await getSession(sessionId);
    if (!session) {
      return {
        authorized: false,
        error: '登录已过期',
        statusCode: 401,
      };
    }

    // 2. 获取权限上下文
    const permissionContext = await getUserPermissionContext(session.userId);
    if (!permissionContext) {
      return {
        authorized: false,
        error: '无法获取用户权限',
        statusCode: 500,
      };
    }

    // 3. 检查权限
    if (options.permissions && options.permissions.length > 0) {
      const userPermissions = permissionContext.permissions;

      if (options.requireAll) {
        const hasAll = options.permissions.every((p: string) => userPermissions.includes(p));
        if (!hasAll) {
          return {
            authorized: false,
            userId: session.userId,
            error: '权限不足',
            statusCode: 403,
          };
        }
      } else {
        const hasAny = options.permissions.some((p: string) => userPermissions.includes(p));
        if (!hasAny) {
          return {
            authorized: false,
            userId: session.userId,
            error: '权限不足',
            statusCode: 403,
          };
        }
      }
    }

    // 4. 检查角色
    if (options.roles && options.roles.length > 0) {
      const userRoleCodes = permissionContext.roles.map((r: { code: string }) => r.code);

      if (options.requireAll) {
        const hasAll = options.roles.every((r: string) => userRoleCodes.includes(r));
        if (!hasAll) {
          return {
            authorized: false,
            userId: session.userId,
            error: '角色权限不足',
            statusCode: 403,
          };
        }
      } else {
        const hasAny = options.roles.some((r: string) => userRoleCodes.includes(r));
        if (!hasAny) {
          return {
            authorized: false,
            userId: session.userId,
            error: '角色权限不足',
            statusCode: 403,
          };
        }
      }
    }

    return {
      authorized: true,
      userId: session.userId,
    };
  } catch (error) {
    console.error('[PermissionCheck] Error:', error);
    return {
      authorized: false,
      error: '权限检查失败',
      statusCode: 500,
    };
  }
}

/**
 * 获取用户的数据范围过滤器
 * 返回允许访问的部门 ID 列表，或者返回 'ALL' 表示不限制
 */
export async function getDataScopeFilter(
  userId: string
): Promise<{ type: 'ALL' | 'LIST'; deptIds?: string[] }> {
  const context = await getUserPermissionContext(userId);
  if (!context) return { type: 'LIST', deptIds: [] };

  if (context.dataScopeType === 'ALL') {
    return { type: 'ALL' };
  }

  if (context.dataScopeType === 'SELF' || context.dataScopeType === 'DEPT') {
    return { type: 'LIST', deptIds: context.deptId ? [context.deptId] : [] };
  }

  if (context.dataScopeType === 'DEPT_AND_SUB') {
    if (!context.deptId) return { type: 'LIST', deptIds: [] };

    try {
      // 递归获取所有子部门 ID，限制深度为 10
      const result = await db.execute(drizzleSql`
        WITH RECURSIVE sub_depts AS (
          SELECT id, 1 as depth FROM departments WHERE id = ${context.deptId}
          UNION ALL
          SELECT d.id, sd.depth + 1 FROM departments d
          INNER JOIN sub_depts sd ON d.parent_id = sd.id
          WHERE sd.depth < 10
        )
        SELECT id FROM sub_depts
      `);
      const rows = result.rows as Array<{ id: string }>;
      return { type: 'LIST', deptIds: rows.map(r => r.id) };
    } catch (error) {
      console.error('[DataScope] getDataScopeFilter query error:', error);
      return { type: 'LIST', deptIds: [context.deptId] };
    }
  }

  if (context.dataScopeType === 'CUSTOM') {
    const roleIds = context.roles.map(r => r.id);
    if (roleIds.length === 0) return { type: 'LIST', deptIds: [] };

    const result = await db.selectDistinct({ deptId: schema.roleDataScopes.deptId })
      .from(schema.roleDataScopes)
      .where(inArray(schema.roleDataScopes.roleId, roleIds));

    return { type: 'LIST', deptIds: result.map((r: { deptId: string }) => r.deptId) };
  }

  return { type: 'LIST', deptIds: [] };
}

/**
 * 权限保护的 API 响应封装
 */
export async function withPermission(
  request: NextRequest,
  options: PermissionCheckOptions,
  handler: (userId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  const check = await checkPermission(request, options);

  if (!check.authorized) {
    return NextResponse.json(
      { error: 'forbidden', message: check.error },
      { status: check.statusCode }
    );
  }

  return handler(check.userId!);
}