'use server';

/**
 * 权限点批量删除 — 独立 Server Action。
 *
 * 每个 id 复用既有 deletePermissionAction：保留码校验、子菜单级联、角色绑定清理、
 * 受影响用户权限缓存刷新全部沿用。个别失败（内置权限/已随父级删除）逐项计数，
 * 不因一个失败回滚已成功的删除。
 */
import { COMMON_ERRORS, PERMISSION_PERMISSIONS } from '@auth-sso/contracts';
import type { ApiResponse } from '@auth-sso/contracts';
import { withAuth } from '@/lib/auth';
import { isUuid } from '@/lib/uuid';
import { deletePermissionAction } from './actions';

const MAX_BULK = 50;

export const bulkDeletePermissionsAction = withAuth(
  { permissions: [PERMISSION_PERMISSIONS.DELETE] },
  async (_ctx, ids: string[]): Promise<ApiResponse<{ deleted: number; failed: number }>> => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: `一次最多删除 ${MAX_BULK} 个权限` };
    }
    const unique = [...new Set(ids)];
    if (unique.some((id) => !isUuid(id))) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: '权限 ID 非法' };
    }
    let deleted = 0;
    let failed = 0;
    for (const id of unique) {
      const res = await deletePermissionAction(id);
      if (res.success) deleted += 1;
      else failed += 1;
    }
    return {
      success: true,
      data: { deleted, failed },
      message: `已删除 ${deleted} 个权限${failed > 0 ? `，${failed} 个失败（内置权限或已随父级删除）` : ''}`,
    };
  },
);
