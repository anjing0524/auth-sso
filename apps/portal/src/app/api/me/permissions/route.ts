/**
 * 当前用户权限上下文 API (GET /api/me/permissions)
 *
 * 委托 resolveIdentity 进行身份验证（React.cache 复用），
 * 消除手动 JWT Cookie 解析的重复代码。
 *
 * @route GET /api/me/permissions
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveIdentity } from '@/lib/auth';
import { getUserPermissionContext } from '@/lib/permissions';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COMMON_ERRORS } from '@auth-sso/contracts';


export async function GET(_request: NextRequest) {
  try {
    const identity = await resolveIdentity();
    if (!identity) {
      return NextResponse.json(
        { error: COMMON_ERRORS.UNAUTHORIZED, message: '未登录' },
        { status: 401 },
      );
    }

    const permissionContext = await getUserPermissionContext(identity.userId);
    if (!permissionContext) {
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '无法获取用户权限上下文' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: {
        userId: identity.userId,
        roles: permissionContext.roles,
        permissions: permissionContext.permissions,
        // 用户角色直属部门 ID（未展开子树；子树展开的 deptIds 见 JWT claims 或 /api/me）
        deptIds: permissionContext.deptIds,
      },
    });
  } catch (err) {
    const mapped = mapDomainError(err);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status },
    );
  }
}
