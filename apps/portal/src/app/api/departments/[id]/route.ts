/**
 * 部门详情与操作 API (REST 薄 Controller)
 *
 * GET 读操作委托给 departments/data.ts 统一读模型。
 */
import { type NextRequest } from 'next/server';
import { withPermission, canAccessDept, logServerDataRead } from '@/lib/auth';
import { DEPARTMENT_ERRORS, COMMON_ERRORS } from '@auth-sso/contracts';
import { getDepartmentById } from '@/app/(dashboard)/departments/data';
import { restSuccess, restError } from '@/lib/response';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/departments/[id] — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['department:read'] }, async (_userId, claims) => {
    const { id } = await params;
    const dept = await getDepartmentById(id);
    if (!dept) return restError(DEPARTMENT_ERRORS.DEPARTMENT_NOT_FOUND, '部门不存在', 404);

    // 数据范围：deptIds 来自 JWT claims，无需额外 DB 查询
    if (!canAccessDept(claims.deptIds, dept.id)) return restError(COMMON_ERRORS.FORBIDDEN, '无权访问该部门', 403);

    // 记录访问日志
    await logServerDataRead('department', id);

    return restSuccess({ ...dept, createdAt: dept.createdAt.toString() });
  });
}
