/**
 * 权限检查中间件
 * 用于保护需要特定权限的 API 路由
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionIdFromCookie } from './session';
import { getUserPermissionContext } from './permissions';

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
      // 只能访问自己部门的数据
      return context.deptId === targetDeptId;

    case 'DEPT':
      // 可以访问本部门数据
      return context.deptId === targetDeptId;

    case 'DEPT_AND_SUB':
      // 可以访问本部门及下级部门数据（需要查询部门层级）
      // TODO: 实现部门层级查询
      return context.deptId === targetDeptId;

    case 'CUSTOM':
      // 自定义数据范围（需要查询 role_data_scopes 表）
      // TODO: 实现自定义数据范围查询
      return false;

    default:
      return false;
  }
}