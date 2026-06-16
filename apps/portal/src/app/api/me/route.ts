/**
 * 获取当前用户信息 API 路由端点
 * GET /api/me - 返回已登录用户的身份、权限上下文及动态菜单树
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJwtFromCookie, verifyJwt, decodeJwtPayload } from '@/lib/session';
import { oauthConfig } from '@/lib/auth/client';
import { getUserPermissionContext } from '@/lib/permissions';
import { db, schema } from '@/infrastructure/db';
import { eq, asc } from 'drizzle-orm';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

interface SidebarMenuItem {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  children?: SidebarMenuItem[];
}

export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null;
    let userinfo: Record<string, any> = {};
    let expiresAt: number | null = null;

    const token = await getJwtFromCookie();
    if (token) {
      const claims = await verifyJwt(token);
      if (claims) {
        userId = claims.sub;
        userinfo = { sub: userId, email: claims.email, name: claims.name };
        const tokenPayload = decodeJwtPayload(token);
        expiresAt = tokenPayload?.exp ? tokenPayload.exp * 1000 : null;
        try {
          const userinfoUrl = new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl);
          const userinfoRes = await fetch(userinfoUrl.toString(), {
            headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
          });
          if (userinfoRes.ok) userinfo = await userinfoRes.json();
        } catch {
          console.warn('[Me GET] IdP userinfo 端点调用失败，降级使用 JWT claims 信息');
        }
      }
    }

    if (!userId) {
      const { auth } = await import('@/infrastructure/auth/auth-instance');
      const session = await auth.api.getSession({ headers: request.headers });
      if (session?.user) {
        userId = session.user.id;
        userinfo = { sub: session.user.id, email: session.user.email, name: session.user.name, picture: session.user.image, email_verified: session.user.emailVerified };
        expiresAt = new Date(session.session.expiresAt).getTime();
      }
    }

    if (!userId) {
      return NextResponse.json({ error: COMMON_ERRORS.UNAUTHORIZED, message: '未登录' }, { status: 401 });
    }

    const permissionContext = await getUserPermissionContext(userId);
    const menuItems = await getDynamicMenus(permissionContext?.permissions || []);

    return NextResponse.json({
      user: { id: userinfo.sub, email: userinfo.email, name: userinfo.name, picture: userinfo.picture, emailVerified: userinfo.email_verified || userinfo.emailVerified },
      tokenInfo: { expiresAt },
      permissions: permissionContext?.permissions || [],
      roles: permissionContext?.roles || [],
      dataScopeType: permissionContext?.dataScopeType || 'SELF',
      deptId: permissionContext?.deptId,
      menus: menuItems,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
  }
}

async function getDynamicMenus(userPermissions: string[]): Promise<SidebarMenuItem[]> {
  const allMenus = await db.select().from(schema.menus).where(eq(schema.menus.status, 'ACTIVE')).orderBy(asc(schema.menus.sort));
  const buildTree = (parentId: string | null = null): SidebarMenuItem[] => {
    return allMenus
      .filter(m => m.parentId === parentId && m.visible)
      .map((m): SidebarMenuItem | null => {
        const hasPermission = !m.permissionCode || userPermissions.includes(m.permissionCode);
        const children = buildTree(m.id);
        if (!hasPermission && children.length === 0) return null;
        return { id: m.id, title: m.name, url: m.path || '#', icon: m.icon, children: children.length > 0 ? children : undefined };
      })
      .filter((m): m is SidebarMenuItem => m !== null);
  };
  return buildTree();
}
