/**
 * 审计日志 API (REST 薄 Controller)
 *
 * GET 读操作委托给 audit/data.ts 统一读模型。
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getAuditLogs } from '@/app/audit/data';
import { AUDIT_OPERATION_VALUES, type AuditOperation } from '@auth-sso/contracts';


/** GET /api/audit/logs — 委托 data.ts */
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['audit:read'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') || '20', 10)));
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
    return NextResponse.json({ success: true, data: result.data, pagination: result.pagination });
  });
}
