/**
 * 权限删除影响面 API (GET /api/permissions/[id]/impact)
 *
 * 只读、供删除确认弹窗使用：返回会级联删除的后代节点数、受影响的角色数与用户数。
 * 权限：permission:delete 或 permission:manage（能删除的人才能看到影响面）。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS, PERMISSION_PERMISSIONS } from '@auth-sso/contracts';
import { getPermissionDeletionImpact } from '@/app/(dashboard)/permissions/data';
import { isUuid } from '@/lib/uuid';
import { restSuccess, restError } from '@/lib/response';

interface RouteParams { params: Promise<{ id: string }>; }

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission(
    { permissions: [PERMISSION_PERMISSIONS.DELETE, PERMISSION_PERMISSIONS.MANAGE] },
    async () => {
      const { id } = await params;
      if (!isUuid(id)) {
        return restError(COMMON_ERRORS.VALIDATION_ERROR, '权限 ID 格式不合法', 400);
      }
      const impact = await getPermissionDeletionImpact(id);
      if (!impact) return restError(COMMON_ERRORS.NOT_FOUND, '权限不存在', 404);
      return restSuccess(impact);
    },
  );
}
