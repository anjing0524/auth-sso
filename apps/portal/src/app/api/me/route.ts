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
    // 1. 从 Cookie 中读取 JWT
    const token = await getJwtFromCookie();
    if (!token) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '未登录' },
        { status: 401 }
      );
    }

    // 2. JWKS 完整验签（包含 jti 黑名单检查）
    const claims = await verifyJwt(token);
    if (!claims) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '登录已过期' },
        { status: 401 }
      );
    }

    const userId = claims.sub;

    // 3. 获取 IdP 最新用户基础信息（name/email/picture 等）
    let userinfo: Record<string, any> = {
      sub: userId,
      email: claims.email,
      name: claims.name,
    };

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
      // 降级使用 JWT claims 中的基础信息，不影响主流程
      console.warn('[Me GET] IdP userinfo 端点调用失败，降级使用 JWT claims 信息');
    }

    // 4. 获取 Portal DB 细粒度权限上下文（RBAC + DataScope）
    const permissionContext = await getUserPermissionContext(userId);

    // 5. 动态过滤菜单树
    const menuItems = await getDynamicMenus(permissionContext?.permissions || []);

    // 6. 从 JWT 中读取 Token 过期时间，供前端决定静默刷新时机
    const tokenPayload = decodeJwtPayload(token);

    return NextResponse.json({
      user: {
        id: userinfo.sub,
        email: userinfo.email,
        name: userinfo.name,
        picture: userinfo.picture,
        emailVerified: userinfo.email_verified,
      },
      // Token 信息（前端用于静默刷新调度）
      tokenInfo: {
        expiresAt: tokenPayload?.exp ? tokenPayload.exp * 1000 : null,
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