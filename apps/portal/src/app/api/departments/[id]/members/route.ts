/**
 * 部门成员 API (REST 薄 Controller)
 *
 * GET 读操作委托给 departments/data.ts 统一读模型。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { getDepartmentById, getDepartmentMembers } from '@/app/(dashboard)/departments/data';

export const runtime = 'nodejs';
interface RouteParams { params: Promise<{ id: string }>; }

/** GET /api/departments/[id]/members — 委托 data.ts */
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withPermission({ permissions: ['user:list'] }, async () => {
    const { id } = await params;

    const dept = await getDepartmentById(id);
    if (!dept) return NextResponse.json({ error: COMMON_ERRORS.NOT_FOUND, message: '部门不存在' }, { status: 404 });

    const members = await getDepartmentMembers(dept.id);
    return NextResponse.json({ data: members });
  });
}
