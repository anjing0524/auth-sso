/**
 * 当前用户角色与权限集 API 路由端点
 *
 * GET /api/me/permissions - 获取当前已登录用户的权限集上下文（包括用户ID、所属角色列表、权限编码集、数据权限范围及部门ID）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJwtFromCookie, verifyJwt } from '@/lib/session';
import { getUserPermissionContext } from '@/lib/permissions';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/me/permissions
 * 获取当前登录会话用户的完整角色及权限集上下文
 *
 * @param request NextRequest 对象
 * @returns JSON 响应，包含用户角色权限详情数据
 */
export async function GET(request: NextRequest) {
  try {
    // 1. 从 JWT Cookie 验签获取用户身份
    const token = await getJwtFromCookie();
    if (!token) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '未登录' },
        { status: 401 }
      );
    }

    const claims = await verifyJwt(token);
    if (!claims) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '登录已过期' },
        { status: 401 }
      );
    }

    // 2. 获取 Portal DB 细粒度权限上下文
    const permissionContext = await getUserPermissionContext(claims.sub);
    if (!permissionContext) {
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '无法获取用户权限上下文' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: {
        userId: claims.sub,
        roles: permissionContext.roles,
        permissions: permissionContext.permissions,
        dataScopeType: permissionContext.dataScopeType,
        deptId: permissionContext.deptId,
      },
    });
  } catch (error) {
    // 捕获系统级异常，控制台细化记录，前台脱敏处理
    console.error('[Me Permissions GET] Failed to fetch session user permission context:', error);
    return NextResponse.json(
      { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取用户权限失败' },
      { status: 500 }
    );
  }
}