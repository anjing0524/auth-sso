/**
 * 权限检查中间件
 * 用于保护需要特定权限的 API 路由
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionIdFromCookie } from './session';
import { getUserPermissionContext } from './permissions';
import { db, schema } from '@/lib/db';
import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';

/**
 * 权限检查选项
 */
export interface PermissionCheckOptions {
  /** 需要的权限编码列表（满足任一即可） */
  permissions?: string[];
  /** 需要的角色编码列表（满足任一即可） */
  roles?: string[];
  /** 是否要求所有权限/角色 */
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
 * 检查用户权限
 * 用于 API 路由中的权限验证
 *
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const check = await checkPermission(request, { permissions: ['user:read'] });
 *   if (!check.authorized) {
 *     return NextResponse.json({ error: check.error }, { status: check.statusCode });
 *   }
 *   // 继续处理请求
 * }
 * ```
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
      console.error('[PermissionCheck] Failed to get permission context for userId:', session.userId);
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
        // 要求拥有所有权限
        const hasAll = options.permissions.every(p => userPermissions.includes(p));
        if (!hasAll) {
          return {
            authorized: false,
            userId: session.userId,
            error: '权限不足',
            statusCode: 403,
          };
        }
      } else {
        // 拥有任一权限即可
        const hasAny = options.permissions.some(p => userPermissions.includes(p));
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
      const userRoleCodes = permissionContext.roles.map(r => r.code);

      if (options.requireAll) {
        // 要求拥有所有角色
        const hasAll = options.roles.every(r => userRoleCodes.includes(r));
        if (!hasAll) {
          return {
            authorized: false,
            userId: session.userId,
            error: '角色权限不足',
            statusCode: 403,
          };
        }
      } else {
        // 拥有任一角色即可
        const hasAny = options.roles.some(r => userRoleCodes.includes(r));
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
  } catch (error: any) {
    console.error('[PermissionCheck] Error:', error.message, error.stack);
    return {
      authorized: false,
      error: '权限检查失败',
      statusCode: 500,
    };
  }
}

/**
 * 创建权限保护的 API 响应
 * 封装了常见的权限检查流程
 *
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   return withPermission(request, { permissions: ['user:read'] }, async (userId) => {
 *     // 处理业务逻辑
 *     return NextResponse.json({ data: [...] });
 *   });
 * }
 * ```
 */
export async function withPermission(
  request: NextRequest,
  options: PermissionCheckOptions,
  handler: (userId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const check = await checkPermission(request, options);

    if (!check.authorized) {
      return NextResponse.json(
        { error: 'forbidden', message: check.error },
        { status: check.statusCode }
      );
    }

    return await handler(check.userId!);
  } catch (error: any) {
    console.error('[withPermission] Execution error:', error.message, error.stack);
    return NextResponse.json(
      { error: 'internal_error', message: '服务执行异常' },
      { status: 500 }
    );
  }
}

/**
 * 检查用户是否有超级管理员权限
 * 超级管理员拥有所有权限
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const context = await getUserPermissionContext(userId);
  if (!context) return false;

  // 检查是否有超级管理员角色
  return context.roles.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');
}

/**
 * 检查数据范围权限
 * 用于判断用户是否可以访问特定部门的数据
 */
export async function checkDataScope(
  userId: string,
  targetDeptId: string
): Promise<boolean> {
  const context = await getUserPermissionContext(userId);
  if (!context) return false;

  switch (context.dataScopeType) {
    case 'ALL':
      // 可以访问所有数据
      return true;

    case 'SELF':
    case 'DEPT':
      // 只能访问自己部门的数据
      return context.deptId === targetDeptId;

    case 'DEPT_AND_SUB': {
      if (!context.deptId) return false;
      if (context.deptId === targetDeptId) return true;

      try {
        // 使用递归查询判断 targetDeptId 是否为 context.deptId 的子部门
        // 限制递归深度为 10 层，防止死循环
        const result = await db.execute(drizzleSql`
          WITH RECURSIVE sub_depts AS (
            SELECT id, 1 as depth FROM departments WHERE id = ${context.deptId}
            UNION ALL
            SELECT d.id, sd.depth + 1 FROM departments d
            INNER JOIN sub_depts sd ON d.parent_id = sd.id
            WHERE sd.depth < 10
          )
          SELECT 1 FROM sub_depts WHERE id = ${targetDeptId}
        `);
        const rows = (result as any).rows || result;
        return rows.length > 0;
      } catch (error) {
        console.error('[DataScope] DEPT_AND_SUB query error:', error);
        // 查询失败时回退到仅检查当前部门，确保安全
        return context.deptId === targetDeptId;
      }
    }

    case 'CUSTOM': {
      // 查询角色自定义数据范围表
      const roleIds = context.roles.map(r => r.id);
      if (roleIds.length === 0) return false;

      const result = await db.select()
        .from(schema.roleDataScopes)
        .where(
          drizzleSql`${schema.roleDataScopes.roleId} IN ${drizzleSql.raw(`(${roleIds.map(id => `'${id}'`).join(',')})`)} AND ${schema.roleDataScopes.deptId} = ${targetDeptId}`
        );

      return result.length > 0;
    }

    default:
      return false;
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
      const rows = (result as any).rows || result;
      console.log('[DataScope] Query result rows count:', rows?.length || 0);
      return { type: 'LIST', deptIds: rows.map((r: any) => r.id) };
    } catch (error: any) {
      console.error('[DataScope] getDataScopeFilter query error:', error.message, error.stack);
      // 查询失败时回退到仅包含当前部门
      return { type: 'LIST', deptIds: [context.deptId] };
    }
  }

  if (context.dataScopeType === 'CUSTOM') {
    const roleIds = context.roles.map(r => r.id);
    if (roleIds.length === 0) return { type: 'LIST', deptIds: [] };

    const result = await db.selectDistinct({ deptId: schema.roleDataScopes.deptId })
      .from(schema.roleDataScopes)
      .where(inArray(schema.roleDataScopes.roleId, roleIds));

    return { type: 'LIST', deptIds: result.map(r => r.deptId) };
  }

  return { type: 'LIST', deptIds: [] };
}