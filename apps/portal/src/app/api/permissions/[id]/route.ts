/**
 * 权限详情 API (REST 薄 Controller)
 *
 * GET 读操作委托给 permissions/data.ts 统一读模型。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS, PERMISSION_PERMISSIONS } from '@auth-sso/contracts';
import { getPermissionById } from '@/app/(dashboard)/permissions/data';
import { restSuccess, restError } from '@/lib/response';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/permissions/[id] — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [PERMISSION_PERMISSIONS.READ] }, async () => {
    const { id } = await params;
    const perm = await getPermissionById(id);
    if (!perm) return restError(COMMON_ERRORS.NOT_FOUND, '权限不存在', 404);
    return restSuccess(perm);
  });
}
