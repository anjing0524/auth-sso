/**
 * 登录日志 API
 * GET /api/audit/login-logs - 获取登录日志列表
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, desc, sql as drizzleSql } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

/**
 * GET /api/audit/login-logs
 * 获取登录日志列表
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

    // 构建条件
    const conditions = [];
    if (userId) {
      conditions.push(eq(schema.loginLogs.userId, userId));
    }
    if (eventType) {
      conditions.push(eq(schema.loginLogs.eventType, eventType));
    }
    if (startDate) {
      conditions.push(drizzleSql`${schema.loginLogs.createdAt} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(drizzleSql`${schema.loginLogs.createdAt} <= ${endDate} 23:59:59`);
    }

    // 查询总数
    const countResult = await db.select({ count: drizzleSql`COUNT(*)::int` })
      .from(schema.loginLogs)
      .where(conditions.length > 0 ? drizzleSql`${conditions.join(' AND ')}` : undefined);
    const total = Number(countResult[0]?.count ?? 0);

    // 查询日志列表
    const logs = await db.select()
      .from(schema.loginLogs)
      .where(conditions.length > 0 ? drizzleSql`${conditions.join(' AND ')}` : undefined)
      .orderBy(desc(schema.loginLogs.createdAt))
      .limit(pageSize)
      .offset(offset);

    return NextResponse.json({
      data: logs.map(log => ({
        id: log.id,
        userId: log.userId,
        username: log.username,
        eventType: log.eventType,
        ip: log.ip,
        userAgent: log.userAgent,
        location: log.location,
        failReason: log.failReason,
        createdAt: log.createdAt,
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