/**
 * 审计日志 API
 * GET /api/audit/logs - 获取操作审计日志列表
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/audit/logs
 * 获取操作审计日志列表
 * 权限要求: audit:read
 *
 * Query 参数:
 * - page: 页码，默认 1
 * - pageSize: 每页数量，默认 20
 * - userId: 用户 ID 筛选
 * - operation: 操作类型筛选
 * - startDate: 开始日期
 * - endDate: 结束日期
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['audit:read'] }, async () => {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const userId = searchParams.get('userId') || '';
    const operation = searchParams.get('operation') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';

    const offset = (page - 1) * pageSize;

    // 构建查询条件
    const conditions: string[] = [];
    if (userId) {
      conditions.push(`user_id = '${userId.replace(/'/g, "''")}'`);
    }
    if (operation) {
      conditions.push(`operation = '${operation.replace(/'/g, "''")}'`);
    }
    if (startDate) {
      conditions.push(`created_at >= '${startDate.replace(/'/g, "''")}'`);
    }
    if (endDate) {
      conditions.push(`created_at <= '${endDate.replace(/'/g, "''")} 23:59:59'`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 查询总数
    const countResult = await sql`
      SELECT COUNT(*) as total FROM audit_logs ${sql.unsafe(whereClause)}
    `;
    const total = parseInt(countResult[0]?.total || '0', 10);

    // 查询日志列表
    const logs = await sql`
      SELECT
        id,
        user_id,
        username,
        operation,
        method,
        url,
        params,
        ip,
        user_agent,
        status,
        duration,
        error_msg,
        created_at
      FROM audit_logs
      ${sql.unsafe(whereClause)}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return NextResponse.json({
      data: logs.map((log: any) => ({
        id: log.id,
        userId: log.user_id,
        username: log.username,
        operation: log.operation,
        method: log.method,
        url: log.url,
        params: log.params,
        ip: log.ip,
        userAgent: log.user_agent,
        status: log.status,
        duration: log.duration,
        errorMsg: log.error_msg,
        createdAt: log.created_at,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  });
}