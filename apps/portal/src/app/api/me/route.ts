/**
 * 获取当前用户信息 API 路由端点（JWT Cookie 无状态版）
 *
 * GET /api/me - 返回已登录用户的身份、权限上下文及动态菜单树
 * 不再依赖 Redis Session，直接从 portal_jwt_token Cookie 验签获取 userId
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJwtFromCookie, verifyJwt, decodeJwtPayload } from '@/lib/session';
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
 * 返回当前已登录用户的基础信息、角色权限列表及动态菜单树
 *
 * @param request NextRequest 对象
 * @returns JSON 响应，包含当前登录会话的所有上下文信息
 */
export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null;
    let userinfo: Record<string, any> = {};
    let expiresAt: number | null = null;

    // 1. 尝试从 Cookie 中读取 JWT 并校验 (兼容旧有方式)
    const token = await getJwtFromCookie();
    if (token) {
      const claims = await verifyJwt(token);
      if (claims) {
        userId = claims.sub;
        userinfo = {
          sub: userId,
          email: claims.email,
          name: claims.name,
        };
        const tokenPayload = decodeJwtPayload(token);
        expiresAt = tokenPayload?.exp ? tokenPayload.exp * 1000 : null;

        try {
          const userinfoUrl = new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl);
          const userinfoRes = await fetch(userinfoUrl.toString(), {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          });
          if (userinfoRes.ok) {
            userinfo = await userinfoRes.json();
          }
        } catch {
          console.warn('[Me GET] IdP userinfo 端点调用失败，降级使用 JWT claims 信息');
        }
      }
    }

    // 2. 如果无 JWT，尝试直接获取本地 Better Auth 用户的 Session
    if (!userId) {
      const { auth } = await import('@/lib/auth');
      const session = await auth.api.getSession({
        headers: request.headers,
      });
      if (session && session.user) {
        userId = session.user.id;
        userinfo = {
          sub: session.user.id,
          email: session.user.email,
          name: session.user.name,
          picture: session.user.image,
          email_verified: session.user.emailVerified,
        };
        expiresAt = new Date(session.session.expiresAt).getTime();
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '未登录' },
        { status: 401 }
      );
    }

    // 3. 获取 Portal DB 细粒度权限上下文（RBAC + DataScope）
    const permissionContext = await getUserPermissionContext(userId);

    // 4. 动态过滤菜单树
    const menuItems = await getDynamicMenus(permissionContext?.permissions || []);

    return NextResponse.json({
      user: {
        id: userinfo.sub,
        email: userinfo.email,
        name: userinfo.name,
        picture: userinfo.picture,
        emailVerified: userinfo.email_verified || userinfo.emailVerified,
      },
      // Token 信息
      tokenInfo: {
        expiresAt,
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
    console.error('[Me GET] 获取用户信息失败:', error);
    return NextResponse.json(
      { error: COMMON_ERRORS.INTERNAL_ERROR, message: '内部错误' },
      { status: 500 }
    );
  }
}

/**
 * 根据用户权限集动态过滤并构建菜单树
 *
 * @param userPermissions 用户拥有的所有权限编码列表
 * @returns 过滤组装后的侧边栏菜单树
 */
async function getDynamicMenus(userPermissions: string[]): Promise<UserMenuItem[]> {
  const allMenus = await db.select().from(schema.menus)
    .where(eq(schema.menus.status, 'ACTIVE'))
    .orderBy(asc(schema.menus.sort));

  /**
   * 递归构建层级菜单树并应用动态过滤
   *
   * @param parentId 父级菜单 ID
   * @returns 树状结构的菜单项列表
   */
  const buildTree = (parentId: string | null = null): UserMenuItem[] => {
    return allMenus
      .filter(m => m.parentId === parentId && m.visible)
      .map((m): UserMenuItem | null => {
        const hasPermission = !m.permissionCode || userPermissions.includes(m.permissionCode);
        const children = buildTree(m.id);

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
      .filter((m): m is UserMenuItem => m !== null);
  };

  return buildTree();
}