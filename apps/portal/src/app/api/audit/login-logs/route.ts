/**
 * 登录日志 API (REST 薄 Controller)
 *
 * GET 读操作委托给 audit/data.ts 统一读模型。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getLoginLogs } from '@/app/audit/data';

export const runtime = 'nodejs';

/** GET /api/audit/login-logs — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['audit:read'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const result = await getLoginLogs({
      page: parseInt(sp.get('page') || '1', 10),
      pageSize: parseInt(sp.get('pageSize') || '20', 10),
      userId: sp.get('userId') || undefined,
      eventType: sp.get('eventType') || undefined,
      startDate: sp.get('startDate') || undefined,
      endDate: sp.get('endDate') || undefined,
    });
    return NextResponse.json(result);
  });
}
