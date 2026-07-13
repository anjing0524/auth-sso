/**
 * 登录日志 API (REST 薄 Controller)
 *
 * GET 读操作委托给 audit/data.ts 统一读模型。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getLoginLogs } from '@/app/audit/data';
import { LOGIN_EVENT_VALUES, type LoginEventType } from '@auth-sso/contracts';


/** GET /api/audit/login-logs — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['audit:read'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') || '20', 10)));
    const rawEvent = sp.get('eventType');
    const eventType = rawEvent && (LOGIN_EVENT_VALUES as readonly string[]).includes(rawEvent)
      ? (rawEvent as LoginEventType)
      : undefined;
    const result = await getLoginLogs({
      page,
      pageSize,
      userId: sp.get('userId') || undefined,
      eventType,
      startDate: sp.get('startDate') || undefined,
      endDate: sp.get('endDate') || undefined,
    });
    return NextResponse.json({ success: true, data: result.data, pagination: result.pagination });
  });
}
