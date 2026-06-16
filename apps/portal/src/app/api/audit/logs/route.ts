/**
 * 审计日志 API 路由端点
 *
 * GET /api/audit/logs - 获取操作审计日志列表 (支持分页、多条件过滤、前置日期安全校验)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/audit/logs
 * 获取操作审计日志列表
 *
 * @param request NextRequest 对象
 * @returns JSON 响应，包含操作日志分页列表
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['audit:read'] }, async () => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const page = parseInt(searchParams.get('page') || '1', 10);
      const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
      const userId = searchParams.get('userId') || '';
      const operation = searchParams.get('operation') || '';
      const startDate = searchParams.get('startDate') || '';
      const endDate = searchParams.get('endDate') || '';

      // 防御性：校验 page 与 pageSize，防止恶意大分页或零值除
      const validPage = isNaN(page) || page < 1 ? 1 : page;
      const validPageSize = isNaN(pageSize) || pageSize < 1 || pageSize > 100 ? 20 : pageSize;
      const offset = (validPage - 1) * validPageSize;

      // 构建查询条件数组，消灭 as any 类型穿透
      const conditions = [];
      if (userId) {
        conditions.push(eq(schema.auditLogs.userId, userId));
      }
      if (operation) {
        conditions.push(eq(schema.auditLogs.operation, operation));
      }

      // 日期前置安全过滤正则：必须符合 YYYY-MM-DD 格式，杜绝任何 SQL 解析隐患或异常参数穿透
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      if (startDate && dateRegex.test(startDate)) {
        conditions.push(gte(schema.auditLogs.createdAt, new Date(`${startDate}T00:00:00`)));
      }
      if (endDate && dateRegex.test(endDate)) {
        conditions.push(lte(schema.auditLogs.createdAt, new Date(`${endDate}T23:59:59.999`)));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // 1. 查询符合条件的数据总条数
      const countResult = await db.select({ count: sql`COUNT(*)::int` })
        .from(schema.auditLogs)
        .where(whereClause);
      const total = Number(countResult[0]?.count ?? 0);

      // 2. 查询分页操作日志列表
      const logs = await db.select()
        .from(schema.auditLogs)
        .where(whereClause)
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(validPageSize)
        .offset(offset);

      return NextResponse.json({
        data: logs.map(log => ({
          id: log.id,
          userId: log.userId,
          username: log.username,
          operation: log.operation,
          method: log.method,
          url: log.url,
          params: log.params,
          ip: log.ip,
          userAgent: log.userAgent,
          status: log.status,
          duration: log.duration,
          errorMsg: log.errorMsg,
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
      // 捕获并记录针对系统运维的底层精细错误，对客户端进行脱敏处理
      console.error('[Audit Logs GET] Failed to fetch audit logs:', error);
      return NextResponse.json(
        { error: COMMON_ERRORS.INTERNAL_ERROR, message: '获取审计日志列表失败' },
        { status: 500 }
      );
    }
  });
}

