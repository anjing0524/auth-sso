/**
 * 用户管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 users/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getUsers } from '@/app/(dashboard)/users/data';

export const runtime = 'nodejs';

/** GET /api/users — 委托 data.ts 获取过滤与分页的用户列表 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['user:list'] }, async (userId) => {
    const sp = request.nextUrl.searchParams;
    const page = parseInt(sp.get('page') || '1', 10);
    const pageSize = parseInt(sp.get('pageSize') || '20', 10);
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const deptId = sp.get('deptId') || undefined;

    const result = await getUsers(userId, { page, pageSize, keyword, status, deptId });
    return NextResponse.json(result);
  });
}
