/**
 * 用户权限 API
 * GET /api/me/permissions - 获取当前用户的权限列表
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionIdFromCookie, getSession } from '@/lib/session';
import { getUserPermissionContext } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * GET /api/me/permissions
 * 获取当前用户的权限上下文（角色和权限列表）
 */
export async function GET(request: NextRequest) {
  try {
    // 1. 检查 Session
    const sessionId = await getSessionIdFromCookie();
    if (!sessionId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'unauthorized', message: '登录已过期' },
        { status: 401 }
      );
    }

    // 2. 获取权限上下文
    const permissionContext = await getUserPermissionContext(session.userId);
    if (!permissionContext) {
      return NextResponse.json(
        { error: 'internal_error', message: '无法获取用户权限' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: {
        userId: session.userId,
        roles: permissionContext.roles,
        permissions: permissionContext.permissions,
        dataScopeType: permissionContext.dataScopeType,
        deptId: permissionContext.deptId,
      },
    });
  } catch (error) {
    console.error('[MePermissions] GET Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取用户权限失败' },
      { status: 500 }
    );
  }
}