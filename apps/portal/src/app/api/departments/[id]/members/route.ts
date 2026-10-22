/**
 * 部门成员 API (REST 薄 Controller)
 *
 * GET 读操作委托给 departments/data.ts 统一读模型。
 * 数据范围由读模型内部施加（scopeFilter，部门与部门列双重约束），
 * 调用方不再手写守卫（ADR-014）；范围外部与不存在部门同形返回 404。
 */
import { type NextRequest } from 'next/server';
import { withPermission, logServerDataRead } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { COMMON_ERRORS, DEPARTMENT_PERMISSIONS } from '@auth-sso/contracts';
import { getDepartmentById, getDepartmentMembers } from '@/app/(dashboard)/departments/data';
import { db } from '@/infrastructure/db';
import { restSuccess, restError } from '@/lib/response';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/departments/[id]/members — 委托 data.ts */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: [DEPARTMENT_PERMISSIONS.READ] }, async (userId) => {
    const { id } = await params;
    const scope = await resolveScope(db, userId);

    const dept = await getDepartmentById(id, scope);
    if (!dept) return restError(COMMON_ERRORS.NOT_FOUND, '部门不存在', 404);

    const members = await getDepartmentMembers(dept.id, scope);
    await logServerDataRead('department_members', dept.id);
    return restSuccess(members);
  });
}
