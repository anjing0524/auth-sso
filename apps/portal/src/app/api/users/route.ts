/**
 * 用户管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 users/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getUsers } from '@/app/(dashboard)/users/data';


/** GET /api/users — 委托 data.ts 获取过滤与分页的用户列表 */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['user:list'] }, async (userId, claims) => {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10));
    const rawPageSize = parseInt(sp.get('pageSize') || '20', 10);
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const deptId = sp.get('deptId') || undefined;

    // deptIds 来自 JWT claims（已含子树展开），无需额外 DB 查询
    const result = await getUsers(claims.deptIds, userId, { page, pageSize, keyword, status, deptId });
    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  });
}
