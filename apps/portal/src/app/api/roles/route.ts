/**
 * 角色管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 roles/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getRoles } from '@/app/roles/data';

export const runtime = 'nodejs';

/** GET /api/roles — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['role:list'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const page = parseInt(sp.get('page') || '1', 10);
    const pageSize = parseInt(sp.get('pageSize') || '10', 10);

    const result = await getRoles({ page, pageSize, keyword, status });
    return NextResponse.json(result);
  });
}
