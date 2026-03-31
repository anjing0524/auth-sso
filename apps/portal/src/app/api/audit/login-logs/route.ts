/**
 * 登录日志 API
 * GET /api/audit/login-logs - 获取登录日志列表
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/audit/login-logs
 * 获取登录日志列表
 * 权限要求: audit:read
 *
 * Query 参数:
 * - page: 页码，默认 1
 * - pageSize: 每页数量，默认 20
 * - userId: 用户 ID 筛选
 * - eventType: 事件类型筛选
 * - startDate: 开始日期
 * - endDate: 结束日期
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['audit:read'] }, async () => {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const userId = searchParams.get('userId') || '';
    const eventType = searchParams.get('eventType') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';

    const offset = (page - 1) * pageSize;

    // 构建查询条件
    const conditions: string[] = [];
    if (userId) {
      conditions.push(`user_id = '${userId.replace(/'/g, "''")}'`);
    }
    if (eventType) {
      conditions.push(`event_type = '${eventType.replace(/'/g, "''")}'`);
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
      SELECT COUNT(*) as total FROM login_logs ${sql.unsafe(whereClause)}
    `;
    const total = parseInt(countResult[0]?.total || '0', 10);

    // 查询日志列表
    const logs = await sql`
      SELECT
        id,
        user_id,
        username,
        event_type,
        ip,
        user_agent,
        location,
        fail_reason,
        created_at
      FROM login_logs
      ${sql.unsafe(whereClause)}
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return NextResponse.json({
      data: logs.map((log: any) => ({
        id: log.id,
        userId: log.user_id,
        username: log.username,
        eventType: log.event_type,
        ip: log.ip,
        userAgent: log.user_agent,
        location: log.location,
        failReason: log.fail_reason,
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