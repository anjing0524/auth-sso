/**
 * 用户管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 users/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { getUsers } from '@/app/(dashboard)/users/data';
import { db } from '@/infrastructure/db';
import { parsePagination } from '@/lib/pagination';
import { restListSuccess, restError } from '@/lib/response';
import { COMMON_ERRORS, USER_PERMISSIONS, USER_STATUS_VALUES } from '@auth-sso/contracts';
import { isUuid } from '@/lib/uuid';


/** GET /api/users — 委托 data.ts 获取过滤与分页的用户列表 */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: [USER_PERMISSIONS.LIST] }, async (userId) => {
    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePagination(sp);
    const keyword = (sp.get('keyword') || '').slice(0, 100);
    // H-C-05：过滤参数先于 SQL 做白名单校验。此前非法枚举/uuid 会下沉到 PG（22P02），
    // 且在 "use cache" 读模型里丢失 SQLSTATE 映射 → 500；应按 API.md §1.2.1（参数白名单）返回 400。
    const status = sp.get('status') || '';
    if (status && status !== 'ALL' && !(USER_STATUS_VALUES as readonly string[]).includes(status)) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, `status 参数不合法（可选值：ALL/${USER_STATUS_VALUES.join('/')}）`, 400);
    }
    const rawDeptId = sp.get('deptId') || undefined;
    if (rawDeptId && !isUuid(rawDeptId)) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, 'deptId 参数必须是 UUID', 400);
    }
    const deptId = rawDeptId;

    const scope = await resolveScope(db, userId);
    const result = await getUsers(scope, userId, { page, pageSize, keyword, status, deptId });
    return restListSuccess(result.data, result.pagination);
  });
}
