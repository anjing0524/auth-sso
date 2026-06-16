/**
 * 用户管理读模型数据获取 (Read Model)
 *
 * 仅在服务端执行（非 Server Action）。使用 lib/user-queries.ts 共享查询模块
 * 消除与 route.ts 的重复代码。
 *
 * 缓存策略 (Next.js 16 Cache Components, R10 / §3.6)：
 * - 使用 "use cache" 指令实现跨请求持久化缓存
 * - 身份鉴权 (headers/cookies) 必须在缓存作用域外完成，userId 作为参数注入
 *   ——严禁在 use cache 作用域内访问 request-scoped 动态 API
 * - cacheTag 标签化，写操作通过 revalidateTag('users-list') 精确失效
 */

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, desc, and, sql as drizzleSql } from 'drizzle-orm';
import { getDataScopeFilter } from '@/lib/auth';
import { UserStatus } from '@auth-sso/contracts';
import {
  USER_LIST_COLUMNS,
  buildUserListConditions,
  isScopeDenied,
} from '@/db/user-queries';

/**
 * 分页与过滤获取用户列表
 *
 * @param userId 当前操作者用户 ID（调用方在缓存作用域外完成鉴权后注入）
 * @param params 分页与过滤参数
 * @returns 用户列表数据及分页信息（纯 JSON 可序列化）
 */
export async function getUsers(
  userId: string,
  params: {
    page: number;
    pageSize: number;
    keyword: string;
    status: string;
  }
) {
  'use cache';
  cacheLife('minutes');
  cacheTag('users-list');

  const { page, pageSize, keyword, status } = params;
  const offset = (page - 1) * pageSize;
  const scopeFilter = await getDataScopeFilter(userId);

  if (isScopeDenied(scopeFilter)) {
    return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
  }

  const conditions = buildUserListConditions({ keyword, status, scopeFilter, userId });

  const query = db
    .select(USER_LIST_COLUMNS)
    .from(schema.users)
    .leftJoin(schema.departments, eq(schema.users.deptId, schema.departments.id));

  const users = await query
    .where(and(...conditions))
    .orderBy(desc(schema.users.createdAt))
    .limit(pageSize)
    .offset(offset);

  const countResult = await db
    .select({ count: drizzleSql`COUNT(*)::int` })
    .from(schema.users)
    .where(and(...conditions));

  const total = Number(countResult[0]?.count ?? 0);

  return {
    data: users.map((u) => ({
      ...u,
      status: u.status as UserStatus,
      name: u.name || u.username || 'Unknown',
      deptName: u.deptName || '未分配',
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * 获取所有部门列表（用于下拉选择）
 */
export async function getDepartments() {
  'use cache';
  cacheLife('hours');
  cacheTag('departments');

  return await db
    .select({ id: schema.departments.id, name: schema.departments.name })
    .from(schema.departments)
    .orderBy(schema.departments.name);
}
