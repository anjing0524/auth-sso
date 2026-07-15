/**
 * 单个用户操作 API (REST 薄 Controller)
 *
 * GET 读操作委托给 users/data.ts 统一读模型，
 * 数据范围检查保留在本层（属于鉴权逻辑，非数据获取逻辑）。
 */
import { type NextRequest } from 'next/server';
import { withPermission, canAccessDept, getUserRoleDeptIds, logServerDataRead } from '@/lib/auth';
import { COMMON_ERRORS, USER_ERRORS } from '@auth-sso/contracts';
import { getUser } from '@/app/(dashboard)/users/data';
import { restSuccess, restError } from '@/lib/response';


interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/users/[id] — 委托 data.ts 获取用户详情 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:read'] }, async (adminUserId) => {
    const { id } = await params;
    const user = await getUser(id);
    if (!user) {
      return restError(USER_ERRORS.USER_NOT_FOUND, '用户不存在', 404);
    }

    const deptIds = await getUserRoleDeptIds(adminUserId);
    if (!canAccessDept(deptIds, user.deptId)) {
      return restError(COMMON_ERRORS.FORBIDDEN, '无权查看该用户', 403);
    }

    // 在 API 契约层记录读取日志，切断 data 层的反向依赖
    await logServerDataRead('user', id);

    return restSuccess(user);
  });
}
