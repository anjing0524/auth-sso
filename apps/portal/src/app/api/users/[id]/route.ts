/**
 * 单个用户操作 API (REST 薄 Controller)
 *
 * GET 读操作委托给 users/data.ts 统一读模型；**数据范围由读口在 SQL 内施加**，
 * 范围外与不存在同形返回 404——读路径不用状态码区分存在性（ADR-014 实施顺序第 3 步）。
 */
import { type NextRequest } from 'next/server';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { COMMON_ERRORS, USER_PERMISSIONS } from '@auth-sso/contracts';
import { getUser } from '@/app/(dashboard)/users/data';
import { restSuccess, restError } from '@/lib/response';
import { db } from '@/infrastructure/db';


interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/users/[id] — 委托 data.ts 获取用户详情 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [USER_PERMISSIONS.READ] }, async (adminUserId) => {
    const { id } = await params;
    const scope = await resolveScope(db, adminUserId);
    const user = await getUser(id, scope);
    if (!user) {
      return restError(COMMON_ERRORS.NOT_FOUND, '用户不存在', 404);
    }

    // 在 API 契约层记录读取日志，切断 data 层的反向依赖
    await logServerDataRead('user', id);

    return restSuccess(user);
  });
}
