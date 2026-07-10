/**
 * Client 管理 API (REST 薄 Controller)
 *
 * GET 读操作委托给 clients/data.ts 统一读模型，消除重复 Drizzle 查询。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getClients } from '@/app/(dashboard)/clients/data';


/** GET /api/clients — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['client:list'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10));
    const rawPageSize = parseInt(sp.get('pageSize') || '20', 10);
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';

    const result = await getClients({ page, pageSize, keyword, status });
    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  });
}
