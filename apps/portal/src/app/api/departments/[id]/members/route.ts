/**
 * 部门成员 API (REST 薄 Controller)
 *
 * GET 读操作委托给 departments/data.ts 统一读模型。
 */
import { type NextRequest } from 'next/server';
import { withPermission, canAccessDept, getUserRoleDeptIds, logServerDataRead } from '@/lib/auth';
import { COMMON_ERRORS, DEPARTMENT_PERMISSIONS } from '@auth-sso/contracts';
import { getDepartmentById, getDepartmentMembers } from '@/app/(dashboard)/departments/data';
import { restSuccess, restError } from '@/lib/response';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/departments/[id]/members — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [DEPARTMENT_PERMISSIONS.READ] }, async (_userId) => {
    const { id } = await params;

    const dept = await getDepartmentById(id);
    if (!dept) return restError(COMMON_ERRORS.NOT_FOUND, '部门不存在', 404);

    const deptIds = await getUserRoleDeptIds(_userId);
    if (!canAccessDept(deptIds, dept.id)) {
      return restError(COMMON_ERRORS.FORBIDDEN, '无权查看该部门成员', 403);
    }

    const members = await getDepartmentMembers(dept.id);
    await logServerDataRead('department_members', dept.id);
    return restSuccess(members);
  });
}
