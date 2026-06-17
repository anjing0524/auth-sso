/**
 * 权限管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 permissions/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getPermissions } from '@/app/(dashboard)/permissions/data';

export const runtime = 'nodejs';

/** GET /api/permissions — 委托 data.ts，支持按 type 过滤 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['permission:list'] }, async () => {
    const type = request.nextUrl.searchParams.get('type') || undefined;
    const data = await getPermissions(type);
    return NextResponse.json({ data });
  });
}
