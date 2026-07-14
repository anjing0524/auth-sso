/**
 * 用户管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 users/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getUsers } from '@/app/(dashboard)/users/data';
import { parsePagination } from '@/lib/pagination';
import { restListSuccess } from '@/lib/response';


/** GET /api/users — 委托 data.ts 获取过滤与分页的用户列表 */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['user:list'] }, async (userId, claims) => {
    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePagination(sp);
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const deptId = sp.get('deptId') || undefined;

    // deptIds 来自 JWT claims（已含子树展开），无需额外 DB 查询
    const result = await getUsers(claims.deptIds, userId, { page, pageSize, keyword, status, deptId });
    return restListSuccess(result.data, result.pagination);
  });
}
