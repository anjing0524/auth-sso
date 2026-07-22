/**
 * 当前用户权限上下文 API (GET /api/me/permissions)
 *
 * 委托 resolveIdentity 进行身份验证（React.cache 复用），
 * 消除手动 JWT Cookie 解析的重复代码。
 *
 * @route GET /api/me/permissions
 */
import { type NextRequest, NextResponse } from 'next/server';
import { resolveIdentity } from '@/lib/auth';
import { getUserPermissionContext } from '@/lib/permissions';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { restSuccess, restError } from '@/lib/response';


export async function GET(_request: NextRequest) {
  try {
    const identity = await resolveIdentity();
    if (!identity) {
      return restError(COMMON_ERRORS.UNAUTHORIZED, '未登录', 401);
    }

    const permissionContext = await getUserPermissionContext(identity.userId);
    if (!permissionContext) {
      return restError(COMMON_ERRORS.INTERNAL_ERROR, '无法获取用户权限上下文', 500);
    }

    return restSuccess({
      userId: identity.userId,
      roles: permissionContext.roles,
      permissions: permissionContext.permissions,
      deptIds: permissionContext.deptIds,
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    return restError(mapped.error, mapped.message, mapped.status);
  }
}
