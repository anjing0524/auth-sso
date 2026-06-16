/**
 * 登录日志 API 路由端点
 *
 * GET /api/audit/login-logs - 获取用户登录日志列表 (支持分页、多条件过滤、前置日期安全校验)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/audit/login-logs
 * 获取登录日志列表
 *
 * @param request NextRequest 对象
 * @returns JSON 响应，包含登录日志分页列表
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['audit:read'] }, async () => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const page = parseInt(searchParams.get('page') || '1', 10);
      const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
      const userId = searchParams.get('userId') || '';
      const eventType = searchParams.get('eventType') || '';
      const startDate = searchParams.get('startDate') || '';
      const endDate = searchParams.get('endDate') || '';

      // 防御性：校验 page 与 pageSize，防止零值除或超大分页攻击
      const validPage = isNaN(page) || page < 1 ? 1 : page;
      const validPageSize = isNaN(pageSize) || pageSize < 1 || pageSize > 100 ? 20 : pageSize;
      const offset = (validPage - 1) * validPageSize;

      // 构建查询条件数组，杜绝 as any
      const conditions = [];
      if (userId) {
        conditions.push(eq(schema.loginLogs.userId, userId));
      }
      if (eventType) {
        conditions.push(eq(schema.loginLogs.eventType, eventType));
      }

      // 日期安全防线：严格验证输入格式为 YYYY-MM-DD
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      if (startDate && dateRegex.test(startDate)) {
        conditions.push(gte(schema.loginLogs.createdAt, new Date(`${startDate}T00:00:00`)));
      }
      if (endDate && dateRegex.test(endDate)) {
        conditions.push(lte(schema.loginLogs.createdAt, new Date(`${endDate}T23:59:59.999`)));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // 1. 查询总行数
      const countResult = await db.select({ count: sql`COUNT(*)::int` })
        .from(schema.loginLogs)
        .where(whereClause);
      const total = Number(countResult[0]?.count ?? 0);

      // 2. 查询分页登录日志列表
      const logs = await db.select()
        .from(schema.loginLogs)
        .where(whereClause)
        .orderBy(desc(schema.loginLogs.createdAt))
        .limit(validPageSize)
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
          page: validPage,
          pageSize: validPageSize,
          total,
          totalPages: Math.ceil(total / validPageSize),
        },
      });
    } catch (error) {
      // 记录精细的原生系统错误日志用于后台调试，对客户端进行异常脱敏
      console.error('[Login Logs GET] Failed to fetch login logs:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取登录日志列表失败' },
        { status: 500 }
      );
    }
  });
}

