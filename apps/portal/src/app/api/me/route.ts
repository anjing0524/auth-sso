/**
 * 获取当前用户信息
 * 返回已登录用户的身份和权限上下文
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getSession,
  getSessionIdFromCookie,
  touchSession,
  updateSessionToken,
  shouldRefreshToken,
  deleteSession,
  clearSessionCookie,
} from '@/lib/session';
import { oauthConfig } from '@/lib/auth-client';
import { getUserPermissionContext } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * GET /api/me
 * 返回当前用户信息
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = await getSessionIdFromCookie();

    if (!sessionId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    // 获取 Session
    const session = await getSession(sessionId);

    if (!session) {
      const response = NextResponse.json(
        { error: 'unauthorized', message: '登录已过期' },
        { status: 401 }
      );
      clearSessionCookie(response);
      return response;
    }

    // 检查 Token 是否需要刷新
    if (shouldRefreshToken(session) && session.refreshToken) {
      const refreshed = await refreshToken(sessionId, session.refreshToken);
      if (!refreshed) {
        // 刷新失败，清除 Session
        await deleteSession(sessionId);
        const response = NextResponse.json(
          { error: 'unauthorized', message: '登录已过期' },
          { status: 401 }
        );
        clearSessionCookie(response);
        return response;
      }
    }

    // 更新最后访问时间
    await touchSession(sessionId);

    // 调用 IdP userinfo 端点获取最新用户信息
    const userinfoUrl = new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl);
    const response = await fetch(userinfoUrl.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token 无效，清除 Session
        await deleteSession(sessionId);
        const clearResponse = NextResponse.json(
          { error: 'unauthorized', message: '登录已过期' },
          { status: 401 }
        );
        clearSessionCookie(clearResponse);
        return clearResponse;
      }
      return NextResponse.json(
        { error: 'userinfo_failed', message: '获取用户信息失败' },
        { status: response.status }
      );
    }

    const userinfo = await response.json();

    // 获取用户权限上下文
    const permissionContext = await getUserPermissionContext(userinfo.sub);

    // 获取并过滤动态菜单
    const menuItems = await getDynamicMenus(permissionContext?.permissions || []);

    return NextResponse.json({
      user: {
        id: userinfo.sub,
        email: userinfo.email,
        name: userinfo.name,
        picture: userinfo.picture,
        emailVerified: userinfo.email_verified,
      },
      session: {
        createdAt: session.createdAt,
        lastAccessAt: session.lastAccessAt,
        expiresAt: session.absoluteExpiresAt,
      },
      // 权限上下文
      permissions: permissionContext?.permissions || [],
      roles: permissionContext?.roles || [],
      dataScopeType: permissionContext?.dataScopeType || 'SELF',
      deptId: permissionContext?.deptId,
      // 动态菜单
      menus: menuItems,
    });
  } catch (error) {
    console.error('[Me] Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '内部错误' },
      { status: 500 }
    );
  }
}

/**
 * 根据用户权限获取动态菜单
 */
async function getDynamicMenus(userPermissions: string[]) {
  const { db } = await import('@/lib/db');
  const { menus } = await import('@/db/schema');
  const { eq, asc } = await import('drizzle-orm');

  // 获取所有启用的菜单
  const allMenus = await db.select().from(menus)
    .where(eq(menus.status, 'ACTIVE'))
    .orderBy(asc(menus.sort));

  // 递归构建菜单树，并根据权限进行过滤
  const buildTree = (parentId: string | null = null): any[] => {
    return allMenus
      .filter(m => m.parentId === parentId && m.visible)
      .map(m => {
        // 1. 检查当前菜单是否有权限
        const hasPermission = !m.permissionCode || userPermissions.includes(m.permissionCode);
        
        // 2. 递归获取子菜单
        const children = buildTree(m.id);
        
        // 3. 过滤逻辑：
        // - 如果有权限，且（是叶子节点 OR 有可见子节点），则保留
        // - 如果没权限，但有可见子节点，通常父节点也应该保留（取决于业务逻辑，这里我们选择保留父节点以展示路径，或者也可以严格过滤）
        // 严格模式：如果菜单本身没权限且没有有权限的子菜单，则过滤掉
        if (!hasPermission && children.length === 0) {
          return null;
        }

        return {
          id: m.id,
          title: m.name,
          url: m.path,
          icon: m.icon,
          children: children.length > 0 ? children : undefined,
        };
      })
      .filter(Boolean); // 移除 null 节点
  };

  return buildTree();
}

/**
 * 刷新 Token
 */
async function refreshToken(sessionId: string, refreshToken: string): Promise<boolean> {
  try {
    const tokenUrl = new URL('/api/auth/oauth2/token', oauthConfig.idpUrl);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: oauthConfig.clientId,
    });

    if (oauthConfig.clientSecret) {
      body.append('client_secret', oauthConfig.clientSecret);
    }

    const response = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      console.error('[Me] Token refresh failed:', response.status);
      return false;
    }

    const tokens = await response.json();

    // 更新 Session 中的 Token
    await updateSessionToken(sessionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 3600,
    });

    return true;
  } catch (error) {
    console.error('[Me] Token refresh error:', error);
    return false;
  }
}