/**
 * 获取当前用户信息 API 路由端点
 *
 * GET /api/me - 返回已登录用户的身份、Session 信息、权限上下文及动态过滤后的菜单树
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
import { db, schema } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * 侧边栏用户菜单项接口定义
 */
interface UserMenuItem {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  children?: UserMenuItem[];
}

/**
 * GET /api/me
 * 返回当前已登录用户的基础信息、Session 状态、角色权限列表及动态菜单树
 *
 * @param request NextRequest 对象
 * @returns JSON 响应，包含当前登录会话的所有上下文信息
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = await getSessionIdFromCookie();

    if (!sessionId) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '未登录' },
        { status: 401 }
      );
    }

    // 获取 Session 会话信息
    const session = await getSession(sessionId);

    if (!session) {
      const response = NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '登录已过期' },
        { status: 401 }
      );
      clearSessionCookie(response);
      return response;
    }

    // 检查 Token 是否需要刷新 (使用无感刷新机制)
    if (shouldRefreshToken(session) && session.refreshToken) {
      const refreshed = await refreshToken(sessionId, session.refreshToken);
      if (!refreshed) {
        // 刷新失败，强制清除失效的 Session
        await deleteSession(sessionId);
        const response = NextResponse.json(
          { error: COMMON_ERRORS.UNAUTHORIZED, message: '登录已过期' },
          { status: 401 }
        );
        clearSessionCookie(response);
        return response;
      }
    }

    // 刷新成功或无需刷新，更新最后活跃访问时间
    await touchSession(sessionId);

    // 调用外部 IdP userinfo 身份端点获取最新用户基础数据
    const userinfoUrl = new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl);
    const response = await fetch(userinfoUrl.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token 被外部废弃，强制清除 Session
        await deleteSession(sessionId);
        const clearResponse = NextResponse.json(
          { error: COMMON_ERRORS.UNAUTHORIZED, message: '登录已过期' },
          { status: 401 }
        );
        clearSessionCookie(clearResponse);
        return clearResponse;
      }
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取用户信息失败' },
        { status: response.status }
      );
    }

    const userinfo = await response.json();

    // 联动查询获取本地用户对应的本地角色与权限上下文
    const permissionContext = await getUserPermissionContext(userinfo.sub);

    // 基于本地取得的权限列表，对系统菜单进行前置动态过滤，交付符合最小权限集要求的菜单树
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
      // 过滤后的动态菜单
      menus: menuItems,
    });
  } catch (error) {
    // 系统级异常捕获并进行控制台记录，防止敏感栈溢出，对客户端实施脱敏
    console.error('[Me GET] Failed to retrieve session user info:', error);
    return NextResponse.json(
      { error: COMMON_ERRORS.INTERNAL_ERROR, message: '内部错误' },
      { status: 500 }
    );
  }
}

/**
 * 根据用户权限集获取并动态过滤的菜单列表树
 *
 * @param userPermissions 用户拥有的所有权限编码列表
 * @returns 过滤组装后的侧边栏用户菜单树
 */
async function getDynamicMenus(userPermissions: string[]): Promise<UserMenuItem[]> {
  // 获取所有启用的系统菜单
  const allMenus = await db.select().from(schema.menus)
    .where(eq(schema.menus.status, 'ACTIVE'))
    .orderBy(asc(schema.menus.sort));

  /**
   * 递归构建层级菜单树并应用动态过滤
   *
   * @param parentId 父级菜单ID
   * @returns 树状结构的菜单项列表
   */
  const buildTree = (parentId: string | null = null): UserMenuItem[] => {
    return allMenus
      .filter(m => m.parentId === parentId && m.visible)
      .map((m): UserMenuItem | null => {
        // 1. 检查当前菜单是否有权限：无权限编码则默认所有人均可见，否则需要严格比对
        const hasPermission = !m.permissionCode || userPermissions.includes(m.permissionCode);
        
        // 2. 递归构建其子菜单
        const children = buildTree(m.id);
        
        // 3. 过滤逻辑：
        // 严格模式下，如果菜单本身无权限，并且子节点列表中也不包含可访问节点，则该路径在树上直接剔除
        if (!hasPermission && children.length === 0) {
          return null;
        }

        return {
          id: m.id,
          title: m.name,
          url: m.path || '#',
          icon: m.icon,
          children: children.length > 0 ? children : undefined,
        };
      })
      .filter((m): m is UserMenuItem => m !== null); // 安全地移除 null 过滤项，收敛 TS 类型
  };

  return buildTree();
}

/**
 * 异步刷新 OAuth 访问 Token
 *
 * @param sessionId 当前的会话ID
 * @param refreshToken 刷新 Token 秘钥
 * @returns 刷新操作是否成功
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
      console.error('[Me TokenRefresh] Failed, HTTP status:', response.status);
      return false;
    }

    const tokens = await response.json();

    // 更新 Redis 存储的 Session Token 信息，实现平滑无感续签
    await updateSessionToken(sessionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 3600,
    });

    return true;
  } catch (error) {
    console.error('[Me TokenRefresh] Exception occurred during token refresh:', error);
    return false;
  }
}