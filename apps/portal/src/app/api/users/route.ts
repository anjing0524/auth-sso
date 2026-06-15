/**
 * 用户管理 API 路由处理器（仅保留 REST 读模型）
 * @module apps/portal/api/users
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, desc, and, sql as drizzleSql } from 'drizzle-orm';
import { withPermission, getDataScopeFilter } from '@/lib/auth-middleware';
import {
  USER_LIST_COLUMNS,
  buildUserListConditions,
  isScopeDenied,
} from '@/lib/user-queries';

export const runtime = 'nodejs';

/**
 * GET /api/users — 获取过滤与分页后的用户列表
 * 权限要求: user:list
 */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['user:list'] }, async (userId) => {
    const sp = request.nextUrl.searchParams;
    const page = parseInt(sp.get('page') || '1', 10);
    const pageSize = parseInt(sp.get('pageSize') || '20', 10);
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';
    const deptId = sp.get('deptId') || '';
    const offset = (page - 1) * pageSize;

    const scopeFilter = await getDataScopeFilter(userId);
    if (isScopeDenied(scopeFilter)) {
      return NextResponse.json({ data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
    }

    const conditions = buildUserListConditions({ keyword, status, scopeFilter, userId });

    // 部门 ID URL 参数二次筛选（在已授权范围内叠加）
    if (deptId) {
      conditions.push(eq(schema.users.deptId, deptId));
    }

    const query = db
      .select(USER_LIST_COLUMNS)
      .from(schema.users)
      .leftJoin(schema.departments, eq(schema.users.deptId, schema.departments.id));

    const users = await query
      .where(and(...conditions))
      .orderBy(desc(schema.users.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [countRow] = await db
      .select({ count: drizzleSql`COUNT(*)::int` })
      .from(schema.users)
      .where(and(...conditions));

    return NextResponse.json({
      data: users.map((u) => ({
        ...u,
        name: u.name || u.username || 'Unknown',
        deptName: u.deptName || '未分配',
      })),
      pagination: { page, pageSize, total: Number(countRow?.count ?? 0), totalPages: Math.ceil(Number(countRow?.count ?? 0) / pageSize) },
    });
  });
}
