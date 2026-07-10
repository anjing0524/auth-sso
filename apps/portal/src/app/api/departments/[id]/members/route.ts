/**
 * 部门成员 API (REST 薄 Controller)
 *
 * GET 读操作委托给 departments/data.ts 统一读模型。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, canAccessDept, logServerDataRead } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { getDepartmentById, getDepartmentMembers } from '@/app/(dashboard)/departments/data';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/departments/[id]/members — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['department:read'] }, async (_userId, claims) => {
    const { id } = await params;

    const dept = await getDepartmentById(id);
    if (!dept) return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: '部门不存在' }, { status: 404 });

    // v3.2: 数据范围校验 — 只能查看授权范围内的部门成员
    // deptIds 来自 JWT claims，无需额外 DB 查询
    if (!canAccessDept(claims.deptIds, dept.id)) {
      return NextResponse.json({ error: COMMON_ERRORS.FORBIDDEN, message: '无权查看该部门成员' }, { status: 403 });
    }

    const members = await getDepartmentMembers(dept.id);
    await logServerDataRead('department_members', dept.id);
    return NextResponse.json({ success: true, data: members });
  });
}
