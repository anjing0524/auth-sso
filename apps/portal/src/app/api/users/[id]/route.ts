/**
 * 单个用户操作 API (REST 薄 Controller)
 *
 * GET 读操作委托给 users/data.ts 统一读模型，
 * 数据范围检查保留在本层（属于鉴权逻辑，非数据获取逻辑）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, canAccessDept, logServerDataRead } from '@/lib/auth';
import { COMMON_ERRORS, USER_ERRORS } from '@auth-sso/contracts';
import { getUser } from '@/app/(dashboard)/users/data';


interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/users/[id] — 委托 data.ts 获取用户详情 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:read'] }, async (adminUserId, claims) => {
    const { id } = await params;
    const user = await getUser(id);
    if (!user) {
      return NextResponse.json(
        { error: USER_ERRORS.USER_NOT_FOUND, message: '用户不存在' },
        { status: 404 },
      );
    }

    // 数据范围检查：管理员只能查看其角色所属部门（含子部门）范围内的用户。
    // 目标用户无部门时同样拒绝（不属于任何可见范围）。
    // deptIds 来自 JWT claims（已含子树展开），无需额外 DB 查询。
    if (!canAccessDept(claims.deptIds, user.deptId)) {
      return NextResponse.json(
        { error: COMMON_ERRORS.FORBIDDEN, message: '无权查看该用户' },
        { status: 403 },
      );
    }

    // 在 API 契约层记录读取日志，切断 data 层的反向依赖
    await logServerDataRead('user', id);

    return NextResponse.json({ success: true, data: user });
  });
}
