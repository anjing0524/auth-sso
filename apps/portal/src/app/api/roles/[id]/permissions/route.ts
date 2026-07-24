/**
 * 角色权限绑定 API
 * GET /api/roles/[id]/permissions — 委托 data.ts 获取角色的权限
 * POST /api/roles/[id]/permissions — 为角色分配权限
 * PUT /api/roles/[id]/permissions — 更新角色权限
 */
import { type NextRequest } from 'next/server';
import { withPermission, canAccessDept, getUserRoleDeptIds, logServerDataRead } from '@/lib/auth';
import { getRolePermissions } from '@/app/(dashboard)/roles/data';
import { COMMON_ERRORS, ROLE_ERRORS, ROLE_PERMISSIONS } from '@auth-sso/contracts';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { restSuccess, restError } from '@/lib/response';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/roles/[id]/permissions — 委托 data.ts，deptIds 由 claims 传入做数据范围校验 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [ROLE_PERMISSIONS.READ] }, async (_userId) => {
    const { id } = await params;
    const role = await db.query.roles.findFirst({
      where: eq(schema.roles.id, id),
      columns: { id: true, deptId: true },
    });
    if (!role) {
      return restError(ROLE_ERRORS.ROLE_NOT_FOUND, '角色不存在', 404);
    }
    const deptIds = await getUserRoleDeptIds(_userId);
    if (!canAccessDept(deptIds, role.deptId)) {
      return restError(COMMON_ERRORS.FORBIDDEN, '无权查看该角色的权限', 403);
    }

    const permissions = await getRolePermissions(id);
    await logServerDataRead('role_permissions', id);
    return restSuccess(permissions);
  });
}
