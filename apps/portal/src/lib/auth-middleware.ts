import 'server-only';

/**
 * 权限与数据范围检查中间件（JWT Cookie 无状态版）
 *
 * 核心变化：移除 Redis Session 查询，改为从 portal_jwt_token Cookie 中
 * 验签并解析 JWT 获取 userId，再查询 DB 获取 Portal 细粒度权限上下文。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJwtFromCookie, verifyJwt, type PortalJwtClaims } from './session';
import { getUserPermissionContext } from './permissions';
import { db, schema } from '@/lib/db';
import { eq, and, inArray, sql as drizzleSql } from 'drizzle-orm';
import { COMMON_ERRORS } from '@auth-sso/contracts';

/**
 * 权限检查选项接口定义
 */
export interface PermissionCheckOptions {
  /** 需要的权限编码列表（requireAll=false 时满足任一即可） */
  permissions?: string[];
  /** 需要的角色编码列表（requireAll=false 时满足任一即可） */
  roles?: string[];
  /** 为 true 时要求满足所有权限/角色，默认 false（满足任一即可） */
  requireAll?: boolean;
}

/**
 * 权限检查结果返回结构定义
 */
export interface PermissionCheckResult {
  authorized: boolean;
  userId?: string;
  /** 验签通过后的完整 JWT 声明（含 roles/permissions/deptId 等） */
  claims?: PortalJwtClaims;
  error?: string;
  statusCode?: number;
}

// ────────────────────────────────────────────────────────────
// 核心鉴权入口
// ────────────────────────────────────────────────────────────

/**
 * 检查用户 JWT 有效性及 Portal 权限
 * 用于 Portal 自身的管理 API 路由保护
 *
 * @param request NextRequest 对象
 * @param options 权限检查选项（角色、权限与组合关系）
 * @returns 鉴权通过状态或精细化失败提示
 */
export async function checkPermission(
  request: NextRequest,
  options: PermissionCheckOptions
): Promise<PermissionCheckResult> {
  try {
    let userId: string | null = null;
    let claims: PortalJwtClaims | null = null;

    // 1. 尝试从 Cookie 中读取 JWT 并校验 (兼容旧有方式)
    const token = await getJwtFromCookie();
    if (token) {
      claims = await verifyJwt(token);
      if (claims) {
        userId = claims.sub;
      }
    }

    // 2. 如果无 JWT 或校验失败，尝试通过 Better Auth 本地 Session 获取身份
    if (!userId) {
      const { auth } = await import('./auth'); // 避免循环依赖，采用动态导入
      const session = await auth.api.getSession({
        headers: request.headers,
      });
      if (session && session.user) {
        userId = session.user.id;
      }
    }

    if (!userId) {
      return { authorized: false, error: '未登录', statusCode: 401 };
    }

    // 3. 获取用户在 Portal DB 中的细粒度权限上下文
    const permissionContext = await getUserPermissionContext(userId);
    if (!permissionContext) {
      console.error('[PermissionCheck] 无法获取用户权限上下文, userId:', userId);
      return { authorized: false, error: '无法获取用户权限', statusCode: 500 };
    }

    // 4. 如果是 Session 方式，则需要在此合成 claims 格式以向下兼容
    if (!claims) {
      claims = {
        sub: userId,
        iss: 'http://localhost:4000',
        aud: 'portal-client',
        jti: 'session_' + userId,
        roles: permissionContext.roles.map(r => r.code),
        permissions: permissionContext.permissions,
        deptId: permissionContext.deptId ?? undefined,
        dataScopeType: permissionContext.dataScopeType,
      } as PortalJwtClaims;
    }

    // 5. 超级管理员直接绕过所有检验
    const userRoleCodes = permissionContext.roles.map(r => r.code);
    if (userRoleCodes.includes('ADMIN') || userRoleCodes.includes('SUPER_ADMIN')) {
      return { authorized: true, userId, claims };
    }

    // 6. 权限编码检查
    if (options.permissions && options.permissions.length > 0) {
      const userPermissions = permissionContext.permissions;
      const check = options.requireAll
        ? options.permissions.every(p => userPermissions.includes(p))
        : options.permissions.some(p => userPermissions.includes(p));

      if (!check) {
        return { authorized: false, userId, claims, error: '权限不足', statusCode: 403 };
      }
    }

    // 7. 角色编码检查
    if (options.roles && options.roles.length > 0) {
      const check = options.requireAll
        ? options.roles.every(r => userRoleCodes.includes(r))
        : options.roles.some(r => userRoleCodes.includes(r));

      if (!check) {
        return { authorized: false, userId, claims, error: '角色权限不足', statusCode: 403 };
      }
    }

    return { authorized: true, userId, claims };
  } catch (error: any) {
    console.error('[PermissionCheck] 鉴权过程异常:', error.message, error.stack);
    return { authorized: false, error: '权限检查失败', statusCode: 500 };
  }
}

/**
 * 创建权限保护的 API 响应包装器
 * 统一处理鉴权失败返回，简化 API 路由的权限保护写法
 *
 * @param request NextRequest 对象
 * @param options 权限控制要求参数
 * @param handler 核心业务处理控制器回调（注入 userId 和 JWT claims）
 * @returns 统一脱敏且契约化的 NextResponse
 */
export async function withPermission(
  request: NextRequest,
  options: PermissionCheckOptions,
  handler: (userId: string, claims: PortalJwtClaims) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const check = await checkPermission(request, options);

    if (!check.authorized) {
      return NextResponse.json(
        { error: COMMON_ERRORS.FORBIDDEN, message: check.error },
        { status: check.statusCode }
      );
    }

    return await handler(check.userId!, check.claims!);
  } catch (error: any) {
    console.error('[withPermission] 服务执行异常:', error.message, error.stack);
    return NextResponse.json(
      { error: COMMON_ERRORS.INTERNAL_ERROR, message: '服务执行异常' },
      { status: 500 }
    );
  }
}

/**
 * 检查用户是否有超级管理员权限（基于 DB 角色，不依赖 JWT claims）
 *
 * @param userId 用户唯一标识 ID
 * @returns 是否为超级管理员
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  try {
    const context = await getUserPermissionContext(userId);
    if (!context) return false;
    return context.roles.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');
  } catch (error) {
    console.error('[isSuperAdmin] 查询超级管理员状态失败:', error);
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// 数据范围（Data Scope）检查
// ────────────────────────────────────────────────────────────

/**
 * 检查数据范围权限
 * 判断用户是否可以访问特定部门的业务数据
 *
 * @param userId 当前操作用户 ID
 * @param targetDeptId 目标部门 ID
 * @param targetUserId 目标资源归属用户 ID（用于 SELF 范围精准过滤）
 * @returns 是否拥有数据访问权限
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
      return true;

    case 'SELF':
      // 精准限制：操作用户与目标资源拥有者必须严格相等
      return !!targetUserId && userId === targetUserId;

    case 'DEPT':
      return context.deptId === targetDeptId;

    case 'DEPT_AND_SUB': {
      if (!context.deptId) return false;
      if (context.deptId === targetDeptId) return true;

      try {
        // 递归 CTE 查询子部门（上限 10 层，防死循环）
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

        const rows = Array.isArray(result)
          ? result
          : ((result as any).rows || (result as any).recordset || []);

        return rows.length > 0;
      } catch (error) {
        console.error('[DataScope] DEPT_AND_SUB 查询异常:', error);
        // 降级回退：仅允许访问当前部门（Default-Deny 最小权限原则）
        return context.deptId === targetDeptId;
      }
    }

    case 'CUSTOM': {
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
 * 返回允许访问的部门 ID 列表，供 DB 查询时追加 WHERE 条件
 *
 * @param userId 用户唯一标识 ID
 * @returns 数据权限范围类型及受控部门 ID 数组
 */
export async function getDataScopeFilter(
  userId: string
): Promise<{ type: 'ALL' | 'LIST' | 'SELF'; deptIds?: string[] }> {
  const context = await getUserPermissionContext(userId);
  if (!context) return { type: 'LIST', deptIds: [] };

  if (context.dataScopeType === 'ALL') return { type: 'ALL' };
  if (context.dataScopeType === 'SELF') return { type: 'SELF' };
  if (context.dataScopeType === 'DEPT') {
    return { type: 'LIST', deptIds: context.deptId ? [context.deptId] : [] };
  }

  if (context.dataScopeType === 'DEPT_AND_SUB') {
    if (!context.deptId) return { type: 'LIST', deptIds: [] };

    try {
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

      const rows = Array.isArray(result)
        ? result
        : ((result as any).rows || (result as any).recordset || []);

      const deptIds = rows
        .map((r: any) => (r && typeof r === 'object' ? (r.id || r.deptId || '') : ''))
        .filter(Boolean);

      return { type: 'LIST', deptIds };
    } catch (error: any) {
      console.error('[DataScope] getDataScopeFilter 查询异常:', error.message);
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