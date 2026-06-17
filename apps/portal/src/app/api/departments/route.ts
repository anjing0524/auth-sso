/**
 * 部门管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 departments/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getDepartments } from '@/app/(dashboard)/departments/data';

export const runtime = 'nodejs';

/** GET /api/departments — 委托 data.ts 获取授权范围内的部门树 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['department:list'] }, async (userId) => {
    const data = await getDepartments(userId);
    return NextResponse.json({ data });
  });
}
