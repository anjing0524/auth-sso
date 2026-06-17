/**
 * 获取当前用户信息 API (GET /api/me)
 *
 * 纯 JWT Cookie 认证——已移除 Better Auth getSession 回退。
 *
 * @route GET /api/me
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJwtFromCookie } from '@/lib/session';
import { verifyAccessToken } from '@/domain/auth/token';
import { getUserPermissionContext } from '@/lib/permissions';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { getUser } from '@/app/(dashboard)/users/data';
import { getAllActiveMenus } from '@/app/(dashboard)/menus/data';

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
    // 纯 JWT Cookie 认证
    const token = await getJwtFromCookie();
    if (!token) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '未登录' },
        { status: 401 },
      );
    }

    const claims = await verifyAccessToken(token);
    if (!claims) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '登录已过期' },
        { status: 401 },
      );
    }

    const userId = claims.sub;

    // 委托 data.ts 获取用户信息
    const user = await getUser(userId);
    if (!user) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '用户不存在' },
        { status: 401 },
      );
    }

    const permissionContext = await getUserPermissionContext(userId);
    const isAdmin = permissionContext?.roles.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN') || false;
    const menuItems = await getDynamicMenus(permissionContext?.permissions || [], isAdmin);

    return NextResponse.json({
      user: {
        id: user.publicId,
        email: user.email,
        name: user.name,
        picture: user.avatarUrl,
        emailVerified: user.emailVerified,
      },
      tokenInfo: { expiresAt: claims.exp ? claims.exp * 1000 : null },
      permissions: permissionContext?.permissions || [],
      roles: permissionContext?.roles || [],
      dataScopeType: permissionContext?.dataScopeType || 'SELF',
      deptId: permissionContext?.deptId,
      menus: menuItems,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status },
    );
  }
}

async function getDynamicMenus(userPermissions: string[], isAdmin: boolean): Promise<SidebarMenuItem[]> {
  // 复用 data.ts 中 'use cache' 缓存的菜单查询，消除每次 /api/me 的 DB 重复查询
  const allMenus = await getAllActiveMenus();

  const buildTree = (parentId: string | null = null): SidebarMenuItem[] => {
    return allMenus
      .filter((m) => m.parentId === parentId && m.visible && m.menuType !== 'BUTTON')
      .map((m): SidebarMenuItem | null => {
        const hasPermission = !m.permissionCode || isAdmin || userPermissions.includes(m.permissionCode);
        const children = buildTree(m.id);
        if (!hasPermission && children.length === 0) return null;
        return {
          id: m.id,
          title: m.name,
          url: m.path || '#',
          icon: m.icon || 'LayoutGrid',
          children: children.length > 0 ? children : undefined,
        };
      })
      .filter((m): m is SidebarMenuItem => m !== null);
  };
  return buildTree();
}
