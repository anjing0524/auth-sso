import 'server-only';

/**
 * 权限与数据范围检查中间件
 * 用于保护 API 路由，执行严密的用户会话鉴权、操作权限比对以及跨部门数据范围（Data Scope）安全隔离
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getSessionIdFromCookie } from './session';
import { getUserPermissionContext } from './permissions';
import { db, schema } from '@/lib/db';
import { eq, and, inArray, sql as drizzleSql } from 'drizzle-orm';
import { COMMON_ERRORS } from '@auth-sso/contracts';

/**
 * 权限检查选项接口定义
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
 * 权限检查结果返回结构定义
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
 * @param request NextRequest 对象
 * @param options 权限检查选项 (配置角色、权限与组合关系)
 * @returns 返回权限检查通过状态或精细的校验失败提示
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

    // 2.5 超级管理员直接绕过所有检验
    const userRoleCodes = permissionContext.roles.map(r => r.code);
    const isSuper = userRoleCodes.includes('ADMIN') || userRoleCodes.includes('SUPER_ADMIN');
    if (isSuper) {
      return {
        authorized: true,
        userId: session.userId,
      };
    }

    // 3. 检查权限
    if (options.permissions && options.permissions.length > 0) {
      const userPermissions = permissionContext.permissions;

      if (options.requireAll) {
        // 要求拥有全部的指定权限
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
        // 拥有任一指定权限即可
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
        // 要求拥有全部的角色
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
    console.error('[PermissionCheck] Error during validation:', error.message, error.stack);
    return {
      authorized: false,
      error: '权限检查失败',
      statusCode: 500,
    };
  }
}

/**
 * 创建权限保护的 API 响应 (全流程契约化包装器)
 *
 * @param request NextRequest 对象
 * @param options 权限控制要求参数
 * @param handler 核心业务处理控制器回调
 * @returns 统一脱敏且契约化的 API NextResponse
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
        { error: COMMON_ERRORS.FORBIDDEN, message: check.error },
        { status: check.statusCode }
      );
    }

    return await handler(check.userId!);
  } catch (error: any) {
    console.error('[withPermission] Service execution exception:', error.message, error.stack);
    return NextResponse.json(
      { error: COMMON_ERRORS.INTERNAL_ERROR, message: '服务执行异常' },
      { status: 500 }
    );
  }
}

/**
 * 检查用户是否有超级管理员权限
 *
 * @param userId 用户唯一标识 ID
 * @returns 返回布尔值代表是否为超级管理员
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  try {
    const context = await getUserPermissionContext(userId);
    if (!context) return false;

    return context.roles.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');
  } catch (error) {
    console.error('[isSuperAdmin] Failed to evaluate admin status:', error);
    return false;
  }
}

/**
 * 检查数据范围权限
 * 用于判断用户是否可以访问特定部门的敏感业务数据
 *
 * @param userId 当前操作用户 ID
 * @param targetDeptId 目标部门 ID
 * @param targetUserId 🔥安全加固：新增目标资源归属用户的 ID，用于 SELF (本人所有权) 精准过滤，从安全架构上杜绝越权
 * @returns 返回布尔值代表是否拥有数据访问权限
 */
export async function checkDataScope(
  userId: string,
  targetDeptId: string,
  targetUserId?: string
): Promise<boolean> {
  const context = await getUserPermissionContext(userId);
  if (!context) return false;

  switch (context.dataScopeType) {
    case 'ALL':
      // 允许访问系统内所有数据
      return true;

    case 'SELF':
      // 🔥已修复：将 SELF (仅本人) 与 DEPT (部门级) 彻底剥离开来
      // 精精准限制：操作用户 userId 必须与目标资源拥有者 targetUserId 严格相等
      return !!targetUserId && userId === targetUserId;

    case 'DEPT':
      // 只能访问自己本部门的数据
      return context.deptId === targetDeptId;

    case 'DEPT_AND_SUB': {
      if (!context.deptId) return false;
      if (context.deptId === targetDeptId) return true;

      try {
        // 使用 CTE 递归查询判断 targetDeptId 是否为当前用户所在 deptId 的子部门 (递归上限 10 层，防死循环)
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

        // 🔥已修复：升级跨数据库驱动的 execute 数组解包防线，保障 node-postgres/postgres.js 多驱动运行兼容性
        const rows = Array.isArray(result)
          ? result
          : ((result as any).rows || (result as any).recordset || []);

        return rows.length > 0;
      } catch (error) {
        console.error('[DataScope] DEPT_AND_SUB query error:', error);
        // 防御性优雅降级：查询发生意外时，回退到仅能检查当前部门，秉承 Default-Deny 最小权限安全原则
        return context.deptId === targetDeptId;
      }
    }

    case 'CUSTOM': {
      // 查询自定义分配的角色数据范围表
      const roleIds = context.roles.map(r => r.id);
      if (roleIds.length === 0) return false;

      const result = await db.select()
        .from(schema.roleDataScopes)
        .where(
          and(
            inArray(schema.roleDataScopes.roleId, roleIds),
            eq(schema.roleDataScopes.deptId, targetDeptId)
          )
        );

      return result.length > 0;
    }

    default:
      return false;
  }
}

/**
 * 获取用户的数据范围过滤器
 * 返回允许访问的部门 ID 列表，或者返回 'ALL' 表示不限制，或者 'SELF' 表示仅本人
 *
 * @param userId 用户唯一标识 ID
 * @returns 返回带有数据权限范围类型的结构体及对应的受控部门 ID 数组
 */
export async function getDataScopeFilter(
  userId: string
): Promise<{ type: 'ALL' | 'LIST' | 'SELF'; deptIds?: string[] }> {
  const context = await getUserPermissionContext(userId);
  if (!context) return { type: 'LIST', deptIds: [] };

  if (context.dataScopeType === 'ALL') {
    return { type: 'ALL' };
  }

  if (context.dataScopeType === 'SELF') {
    return { type: 'SELF' };
  }

  if (context.dataScopeType === 'DEPT') {
    return { type: 'LIST', deptIds: context.deptId ? [context.deptId] : [] };
  }

  if (context.dataScopeType === 'DEPT_AND_SUB') {
    if (!context.deptId) return { type: 'LIST', deptIds: [] };

    try {
      // 递归获取本部门及所有子部门 ID (上限 10 层)
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

      // 🔥已修复：升级跨数据库驱动的结果解包防撞安全网，防止特定属性在 map 时为 undefined 崩溃
      const rows = Array.isArray(result)
        ? result
        : ((result as any).rows || (result as any).recordset || []);

      const deptIds = rows.map((r: any) => {
        if (!r || typeof r !== 'object') return '';
        return r.id || r.deptId || '';
      }).filter(Boolean);

      return { type: 'LIST', deptIds };
    } catch (error: any) {
      console.error('[DataScope] getDataScopeFilter query error:', error.message, error.stack);
      // 优雅降级：故障时仅退回到当前所属部门，确保安全兜底
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