/**
 * Client 管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 clients/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getClients } from '@/app/(dashboard)/clients/data';
import { parsePagination } from '@/lib/pagination';
import { restListSuccess, restError } from '@/lib/response';
import { CLIENT_PERMISSIONS, COMMON_ERRORS, ENTITY_STATUS_VALUES } from '@auth-sso/contracts';


/** GET /api/clients — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: [CLIENT_PERMISSIONS.LIST] }, async () => {
    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePagination(sp);
    const keyword = (sp.get('keyword') || '').slice(0, 100);
    // H-C-05：此前非法 status 被 data.ts 静默忽略（返回全量）；非法值必须显式 400。
    const status = sp.get('status') || '';
    if (status && !(ENTITY_STATUS_VALUES as readonly string[]).includes(status)) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, `status 参数不合法（可选值：${ENTITY_STATUS_VALUES.join('/')}）`, 400);
    }

    const result = await getClients({ page, pageSize, keyword, status });
    return restListSuccess(result.data, result.pagination);
  });
}
