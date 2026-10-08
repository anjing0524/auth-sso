/**
 * 角色详情与操作 API (REST 薄 Controller)
 */
import { type NextRequest } from 'next/server';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { ROLE_ERRORS, ROLE_PERMISSIONS } from '@auth-sso/contracts';
import { getRoleById } from '@/app/(dashboard)/roles/data';
import { restSuccess, restError } from '@/lib/response';
import { db } from '@/infrastructure/db';

interface RouteParams { params: Promise<{ id: string }>; }

/**
 * GET /api/roles/[id] — 委托 data.ts
 *
 * 数据范围由读模型内部施加（scopeFilter），调用方不再手写守卫。
 * 范围外角色与不存在角色同形返回 404，避免用状态码探测角色是否存在。
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [ROLE_PERMISSIONS.READ] }, async (userId) => {
    const { id } = await params;
    const scope = await resolveScope(db, userId);

    const role = await getRoleById(id, scope);
    if (!role) return restError(ROLE_ERRORS.ROLE_NOT_FOUND, '角色不存在', 404);

    // 在 API 契约层记录读取日志，切断 data 层的反向依赖
    await logServerDataRead('role', id);

    return restSuccess(role);
  });
}
