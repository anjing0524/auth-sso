/**
 * 登录日志 API (REST 薄 Controller)
 *
 * GET 读操作委托给 audit/data.ts 统一读模型。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getLoginLogs } from '@/app/audit/data';
import { LOGIN_EVENT_VALUES, type LoginEventType } from '@auth-sso/contracts';
import { parsePagination } from '@/lib/pagination';
import { restListSuccess } from '@/lib/response';


/** GET /api/audit/login-logs — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['audit:read'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePagination(sp);
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
    return restListSuccess(result.data, result.pagination);
  });
}
