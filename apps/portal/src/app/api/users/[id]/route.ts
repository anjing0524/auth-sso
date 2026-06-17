/**
 * 单个用户操作 API (REST 薄 Controller)
 *
 * GET 读操作委托给 users/data.ts 统一读模型，
 * 数据范围检查保留在本层（属于鉴权逻辑，非数据获取逻辑）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, checkDataScope, getDataScopeFilter } from '@/lib/auth';
import { COMMON_ERRORS, USER_ERRORS } from '@auth-sso/contracts';
import { getUser } from '@/app/users/data';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/users/[id] — 委托 data.ts 获取用户详情 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(request, { permissions: ['user:read'] }, async (adminUserId) => {
    const { id } = await params;
    const user = await getUser(id);
    if (!user) {
      return NextResponse.json(
        { error: USER_ERRORS.USER_NOT_FOUND, message: '用户不存在' },
        { status: 404 },
      );
    }

    // 数据范围检查：管理员必须有权限查看该用户所属部门
    if (user.deptId) {
      const hasScope = await checkDataScope(adminUserId, user.deptId);
      if (!hasScope) {
        return NextResponse.json(
          { error: COMMON_ERRORS.FORBIDDEN, message: '无权查看该用户' },
          { status: 403 },
        );
      }
    } else {
      const filter = await getDataScopeFilter(adminUserId);
      if (filter.type !== 'ALL') {
        return NextResponse.json(
          { error: COMMON_ERRORS.FORBIDDEN, message: '无权查看无部门用户' },
          { status: 403 },
        );
      }
    }

    return NextResponse.json({ data: user });
  });
}
