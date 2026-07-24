/**
 * 审计日志 API (REST 薄 Controller)
 *
 * GET 读操作委托给 audit/data.ts 统一读模型。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getAuditLogs } from '@/app/audit/data';
import { AUDIT_OPERATION_VALUES, AUDIT_PERMISSIONS, type AuditOperation } from '@auth-sso/contracts';
import { parsePagination } from '@/lib/pagination';
import { restListSuccess } from '@/lib/response';


/** GET /api/audit/logs — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: [AUDIT_PERMISSIONS.READ] }, async () => {
    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = parsePagination(sp);
    const rawOp = sp.get('operation');
    const operation = rawOp && (AUDIT_OPERATION_VALUES as readonly string[]).includes(rawOp)
      ? (rawOp as AuditOperation)
      : undefined;
    const result = await getAuditLogs({
      page,
      pageSize,
      userId: sp.get('userId') || undefined,
      operation,
      startDate: sp.get('startDate') || undefined,
      endDate: sp.get('endDate') || undefined,
    });
    return restListSuccess(result.data, result.pagination);
  });
}
