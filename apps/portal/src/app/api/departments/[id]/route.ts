/**
 * 部门详情与操作 API (REST 薄 Controller)
 *
 * GET 读操作委托给 departments/data.ts 统一读模型。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, checkDataScope } from '@/lib/auth';
import { DEPARTMENT_ERRORS, COMMON_ERRORS } from '@auth-sso/contracts';
import { getDepartmentById } from '@/app/(dashboard)/departments/data';

interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/departments/[id] — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['department:read'] }, async (userId) => {
    const { id } = await params;
    const dept = await getDepartmentById(id);
    if (!dept) return NextResponse.json({ error: DEPARTMENT_ERRORS.DEPARTMENT_NOT_FOUND, message: '部门不存在' }, { status: 404 });

    const hasScope = await checkDataScope(userId, dept.id);
    if (!hasScope) return NextResponse.json({ error: COMMON_ERRORS.FORBIDDEN, message: '无权访问该部门' }, { status: 403 });

    return NextResponse.json({ data: { ...dept, createdAt: dept.createdAt.toString() } });
  });
}
