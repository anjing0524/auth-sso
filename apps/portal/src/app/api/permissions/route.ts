/**
 * 权限管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 permissions/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getPermissionPage } from '@/app/(dashboard)/permissions/data';
import { parsePagination } from '@/lib/pagination';
import { restListSuccess } from '@/lib/response';
import { PERMISSION_PERMISSIONS } from '@auth-sso/contracts';


/** GET /api/permissions — 委托 data.ts，支持按 type 过滤和数据库分页 */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: [PERMISSION_PERMISSIONS.LIST] }, async () => {
    const sp = request.nextUrl.searchParams;
    const type = sp.get('type') || undefined;
    const { page, pageSize } = parsePagination(sp, 50);
    const result = await getPermissionPage({ type, page, pageSize });
    return restListSuccess(result.data, result.pagination);
  });
}
