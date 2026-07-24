/**
 * 用户管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 users/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { type NextRequest } from 'next/server';
import { withPermission, getUserRoleDeptIds } from '@/lib/auth';
import { getUsers } from '@/app/(dashboard)/users/data';
import { parsePagination } from '@/lib/pagination';
import { restListSuccess } from '@/lib/response';
import { USER_PERMISSIONS } from '@auth-sso/contracts';


/** GET /api/users — 委托 data.ts 获取过滤与分页的用户列表 */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: [USER_PERMISSIONS.LIST] }, async (userId) => {
    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePagination(sp);
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const deptId = sp.get('deptId') || undefined;

    const deptIds = await getUserRoleDeptIds(userId);
    const result = await getUsers(deptIds, userId, { page, pageSize, keyword, status, deptId });
    return restListSuccess(result.data, result.pagination);
  });
}
