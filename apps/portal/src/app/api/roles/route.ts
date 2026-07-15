/**
 * 角色管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 roles/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { type NextRequest } from 'next/server';
import { withPermission, getUserRoleDeptIds } from '@/lib/auth';
import { getRoles } from '@/app/(dashboard)/roles/data';
import { parsePagination } from '@/lib/pagination';
import { restListSuccess } from '@/lib/response';


/** GET /api/roles — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['role:list'] }, async (_adminUserId) => {
    const sp = request.nextUrl.searchParams;
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const { page, pageSize } = parsePagination(sp);

    const deptIds = await getUserRoleDeptIds(_adminUserId);
    const result = await getRoles({ page, pageSize, keyword, status, deptIds });
    return restListSuccess(result.data, result.pagination);
  });
}
