/**
 * 部门详情与操作 API (REST 薄 Controller)
 *
 * GET 读操作委托给 departments/data.ts 统一读模型。
 * 数据范围由读模型内部施加（scopeFilter），调用方不再手写守卫（ADR-014）：
 * 范围外部门与不存在部门同形返回 404，避免通过状态码区分探测部门是否存在。
 */
import { type NextRequest } from 'next/server';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { DEPARTMENT_ERRORS, DEPARTMENT_PERMISSIONS } from '@auth-sso/contracts';
import { getDepartmentById } from '@/app/(dashboard)/departments/data';
import { db } from '@/infrastructure/db';
import { restSuccess, restError } from '@/lib/response';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/departments/[id] — 委托 data.ts */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [DEPARTMENT_PERMISSIONS.READ] }, async (userId) => {
    const { id } = await params;
    const scope = await resolveScope(db, userId);

    const dept = await getDepartmentById(id, scope);
    if (!dept) return restError(DEPARTMENT_ERRORS.DEPARTMENT_NOT_FOUND, '部门不存在', 404);

    // 记录访问日志
    await logServerDataRead('department', id);

    return restSuccess({ ...dept, createdAt: dept.createdAt.toString() });
  });
}
