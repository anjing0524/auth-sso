/**
 * 获取当前用户信息 API (GET /api/me)
 *
 * 纯 JWT Cookie 认证——已移除 Better Auth getSession 回退。
 *
 * @route GET /api/me
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJwtFromCookie } from '@/lib/session';
import { verifyAccessToken } from '@/lib/auth/token';
import { getUserPermissionContext } from '@/lib/permissions';
import { getDynamicMenuTree } from '@/lib/menu-tree';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COMMON_ERRORS, ADMIN_ROLE_CODES } from '@auth-sso/contracts';
import { getUser } from '@/app/(dashboard)/users/data';

export const runtime = 'nodejs';

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
    const isAdmin = permissionContext?.roles.some(
      (r) => (ADMIN_ROLE_CODES as readonly string[]).includes(r.code),
    ) ?? false;
    const menuItems = await getDynamicMenuTree(permissionContext?.permissions || [], isAdmin);

    return NextResponse.json({
      user: {
        id: user.publicId,
        email: user.email,
        name: user.name,
        picture: user.avatarUrl,
        emailVerified: user.emailVerified,
      },
      tokenInfo: { expiresAt: claims.exp ? claims.exp * 1000 : null, issuedAt: claims.iat ? claims.iat * 1000 : null },
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
