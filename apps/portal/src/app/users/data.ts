/**
 * 用户管理数据获取辅助函数（仅在服务端执行，非 Server Action）
 */

import { db, schema } from '@/lib/db';
import { eq, ne, or, ilike, inArray, desc, and, sql as drizzleSql } from 'drizzle-orm';
import { checkPermission, getDataScopeFilter } from '@/lib/auth-middleware';
import { UserStatus } from '@auth-sso/contracts';
import { headers } from 'next/headers';

/**
 * 分页与过滤获取用户列表
 * 
 * @param params 过滤与分页参数
 * @returns 用户列表数据及分页信息
 */
export async function getUsers(params: {
  page: number;
  pageSize: number;
  keyword: string;
  status: string;
}) {
  // 1. 鉴权：检查当前用户是否具有用户列表查看权限
  const check = await checkPermission(await headers(), { permissions: ['user:list'] });
  if (!check.authorized || !check.userId) {
    throw new Error('未授权访问或权限不足');
  }

  const { page, pageSize, keyword, status } = params;
  const offset = (page - 1) * pageSize;

  // 2. 获取数据范围过滤规则
  const scopeFilter = await getDataScopeFilter(check.userId);

  // 3. 构建查询
  const query = db
    .select({
      id: schema.users.id,
      publicId: schema.users.publicId,
      username: schema.users.username,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      status: schema.users.status,
      deptId: schema.users.deptId,
      deptName: schema.departments.name,
      createdAt: schema.users.createdAt,
      lastLoginAt: schema.users.lastLoginAt,
    })
    .from(schema.users)
    .leftJoin(schema.departments, eq(schema.users.deptId, schema.departments.id));

  // 默认排除逻辑删除的用户
  const conditions = [ne(schema.users.status, 'DELETED')];

  if (keyword) {
    const searchFilter = or(
      ilike(schema.users.name, `%${keyword}%`),
      ilike(schema.users.email, `%${keyword}%`),
      ilike(schema.users.username, `%${keyword}%`)
    );
    if (searchFilter) {
      conditions.push(searchFilter);
    }
  }

  if (status && status !== 'ALL') {
    conditions.push(eq(schema.users.status, status as UserStatus));
  }

  // 应用数据范围过滤
  if (scopeFilter.type === 'LIST') {
    const allowedDeptIds = scopeFilter.deptIds || [];
    if (allowedDeptIds.length === 0) {
      return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
    }
    conditions.push(inArray(schema.users.deptId, allowedDeptIds));
  } else if (scopeFilter.type === 'SELF') {
    conditions.push(eq(schema.users.id, check.userId));
  }

  // 4. 执行数据查询与计数查询
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
      id: u.id,
      publicId: u.publicId,
      username: u.username,
      email: u.email,
      name: u.name || u.username || 'Unknown',
      avatarUrl: u.avatarUrl,
      status: u.status,
      deptId: u.deptId,
      deptName: u.deptName || '未分配',
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * 获取所有部门列表（用于下拉选择）
 * 
 * @returns 部门列表简要信息
 */
export async function getDepartments() {
  try {
    const list = await db
      .select({
        id: schema.departments.id,
        name: schema.departments.name,
      })
      .from(schema.departments)
      .orderBy(schema.departments.name);

    return list;
  } catch (error) {
    console.error('[getDepartments] Error:', error);
    return [];
  }
}
