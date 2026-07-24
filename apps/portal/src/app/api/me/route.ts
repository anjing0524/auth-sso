/**
 * 获取当前用户信息 API (GET /api/me)
 *
 * 优先信任 Gateway X-User-Id 注入路径（零验签，零额外 I/O）：
 * - 有 X-User-Id → resolveIdentity 从 Cookie JWT 快速解码 claims（不验签）
 * - 无 X-User-Id → resolveIdentity 自验签兜底（本地开发场景）
 *
 * 权限/角色/数据范围从 Redis 获取，与 (dashboard)/layout.tsx 的处理模式完全对齐。
 *
 * @route GET /api/me
 */
import { type NextRequest } from 'next/server';
import { resolveIdentity } from '@/lib/auth';
import { getDynamicMenuTree } from '@/lib/menu-tree';
import { getUserPermissionContext } from '@/lib/permissions';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COMMON_ERRORS, ADMIN_ROLE_CODES } from '@auth-sso/contracts';
import { restSuccess, restError } from '@/lib/response';
import { getUser } from '@/app/(dashboard)/users/data';


export async function GET(_request: NextRequest) {
  try {
    // Gateway 已完成 ES256 验签 + jti 黑名单，Portal 信任其注入的 X-User-Id
    // resolveIdentity: 有 X-User-Id → Cookie 快速解码（零验签）；无则自验签兜底
    const identity = await resolveIdentity();
    if (!identity) {
      return restError(COMMON_ERRORS.UNAUTHORIZED, '未登录', 401);
    }

    const { userId, claims } = identity;

    const permCtx = await getUserPermissionContext(userId);
    const roles = permCtx?.roles.map(r => r.code) ?? [];
    const permissions = permCtx?.permissions ?? [];
    const deptIds = permCtx?.deptIds ?? [];
    const isAdmin = roles.some((r) => (ADMIN_ROLE_CODES as readonly string[]).includes(r));
    const menuItems = await getDynamicMenuTree(permissions, isAdmin);

    const user = await getUser(userId);
    if (!user) {
      return restError(COMMON_ERRORS.UNAUTHORIZED, '用户不存在', 401);
    }

    return restSuccess({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.avatarUrl,
        emailVerified: user.emailVerified,
      },
      tokenInfo: {
        expiresAt: claims.exp ? claims.exp * 1000 : null,
        issuedAt: claims.iat ? claims.iat * 1000 : null,
      },
      permissions,
      roles,
      deptIds,
      menus: menuItems,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    return restError(mapped.error, mapped.message, mapped.status);
  }
}
