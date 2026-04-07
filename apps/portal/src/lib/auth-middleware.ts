/**
 * 权限检查中间件
 * 用于保护需要特定权限的 API 路由
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionIdFromCookie } from './session';
import { getUserPermissionContext } from './permissions';
import { sql } from './db';

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
  const check = await checkPermission(request, options);

  if (!check.authorized) {
    return NextResponse.json(
      { error: 'forbidden', message: check.error },
      { status: check.statusCode }
    );
  }

  return handler(check.userId!);
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

      // 使用递归查询判断 targetDeptId 是否为 context.deptId 的子部门
      const result = await sql`
        WITH RECURSIVE sub_depts AS (
          SELECT id FROM departments WHERE id = ${context.deptId}
          UNION ALL
          SELECT d.id FROM departments d
          INNER JOIN sub_depts sd ON d.parent_id = sd.id
        )
        SELECT 1 FROM sub_depts WHERE id = ${targetDeptId}
      `;
      return result.length > 0;
    }

    case 'CUSTOM': {
      // 查询角色自定义数据范围表
      const roleIds = context.roles.map(r => r.id);
      if (roleIds.length === 0) return false;

      const result = await sql`
        SELECT 1 FROM role_data_scopes 
        WHERE role_id IN ${sql(roleIds)} AND dept_id = ${targetDeptId}
      `;
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

    // 递归获取所有子部门 ID
    const result = await sql`
      WITH RECURSIVE sub_depts AS (
        SELECT id FROM departments WHERE id = ${context.deptId}
        UNION ALL
        SELECT d.id FROM departments d
        INNER JOIN sub_depts sd ON d.parent_id = sd.id
      )
      SELECT id FROM sub_depts
    `;
    return { type: 'LIST', deptIds: result.map((r: any) => r.id) };
  }

  if (context.dataScopeType === 'CUSTOM') {
    const roleIds = context.roles.map(r => r.id);
    if (roleIds.length === 0) return { type: 'LIST', deptIds: [] };

    const result = await sql`
      SELECT DISTINCT dept_id FROM role_data_scopes 
      WHERE role_id IN ${sql(roleIds)}
    `;
    return { type: 'LIST', deptIds: result.map((r: any) => r.dept_id) };
  }

  return { type: 'LIST', deptIds: [] };
}