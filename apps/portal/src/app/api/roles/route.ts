/**
 * 角色管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 roles/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { getRoles } from '@/app/(dashboard)/roles/data';
import { db } from '@/infrastructure/db';
import { parsePagination } from '@/lib/pagination';
import { restListSuccess } from '@/lib/response';
import { ROLE_PERMISSIONS, USER_PERMISSIONS } from '@auth-sso/contracts';


/** GET /api/roles — 委托 data.ts */
export async function GET(request: NextRequest) {
  // 读取角色的两种正当身份：角色管理（role:list）与用户角色分配（user:assign_role，
  // 分配对话框需要枚举候选角色）。此前只认 role:list，只有 assign_role 的操作员
  // 打开分配对话框会静默拿到 403 空列表。
  return withPermission(
    { permissions: [ROLE_PERMISSIONS.LIST, USER_PERMISSIONS.ASSIGN_ROLE] },
    async (_adminUserId) => {
    const sp = request.nextUrl.searchParams;
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const { page, pageSize } = parsePagination(sp);

    const scope = await resolveScope(db, _adminUserId);
    const result = await getRoles({ page, pageSize, keyword, status, scope });
    return restListSuccess(result.data, result.pagination);
  });
}
