/**
 * 角色权限绑定 API
 * GET /api/roles/[id]/permissions — 委托 data.ts 获取角色的权限
 * POST /api/roles/[id]/permissions — 为角色分配权限
 * PUT /api/roles/[id]/permissions — 更新角色权限
 */
import { type NextRequest } from 'next/server';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { getRoleById, getRolePermissions } from '@/app/(dashboard)/roles/data';
import { ROLE_ERRORS, ROLE_PERMISSIONS } from '@auth-sso/contracts';
import { db } from '@/infrastructure/db';
import { restSuccess, restError } from '@/lib/response';

interface RouteParams { params: Promise<{ id: string }>; }

/**
 * GET /api/roles/[id]/permissions — 委托 data.ts
 *
 * 数据范围由读模型内部施加（scopeFilter）；范围外角色与不存在角色同形返回 404
 * （此前本路由自行查角色再判 403，属重复守卫，见 ADR-014）。
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [ROLE_PERMISSIONS.READ] }, async (userId) => {
    const { id } = await params;
    const scope = await resolveScope(db, userId);

    const role = await getRoleById(id, scope);
    if (!role) {
      return restError(ROLE_ERRORS.ROLE_NOT_FOUND, '角色不存在', 404);
    }

    const permissions = await getRolePermissions(id, scope);
    await logServerDataRead('role_permissions', id);
    return restSuccess(permissions);
  });
}
