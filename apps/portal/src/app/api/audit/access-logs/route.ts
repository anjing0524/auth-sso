/**
 * 访问日志 API (REST 薄 Controller)
 *
 * GET 读操作委托给 audit/data.ts 统一读模型。
 * 复用 audit:read 权限（访问日志与审计日志同属安全查看范畴，不新建权限码）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getAccessLogs } from '@/app/audit/data';


/** GET /api/audit/access-logs — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['audit:read'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const result = await getAccessLogs({
      page: parseInt(sp.get('page') || '1', 10),
      pageSize: parseInt(sp.get('pageSize') || '20', 10),
      userId: sp.get('userId') || undefined,
      resourceType: sp.get('resourceType') || undefined,
      resourceId: sp.get('resourceId') || undefined,
      startDate: sp.get('startDate') || undefined,
      endDate: sp.get('endDate') || undefined,
    });
    return NextResponse.json(result);
  });
}
