/**
 * 用户管理读模型数据获取 (Read Model)
 *
 * 仅在服务端执行（非 Server Action）。使用 lib/user-queries.ts 共享查询模块
 * 消除与 route.ts 的重复代码。所有只读查询统一收拢至此文件。
 *
 * 缓存策略 (Next.js 16 Cache Components, R10 / §3.6)：
 * - 列表查询使用 "use cache" + cacheTag 实现跨请求持久化缓存
 * - 身份鉴权 (headers/cookies) 必须在缓存作用域外完成，userId 作为参数注入
 *   ——严禁在 use cache 作用域内访问 request-scoped 动态 API
 * - cacheTag 标签化，写操作通过 revalidatePath 精确失效
 * - 单用户详情查询不使用缓存，保证数据实时性
 */

import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, desc, and, count, or } from 'drizzle-orm';
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
    /** 可选：按部门 ID 过滤（在数据范围已授权的基础上叠加筛选） */
    deptId?: string;
  }
) {
  'use cache';
  cacheLife('minutes');
  cacheTag('users-list');

  const { page, pageSize, keyword, status, deptId } = params;
  const offset = (page - 1) * pageSize;
  const scopeFilter = await getDataScopeFilter(userId);

  if (isScopeDenied(scopeFilter)) {
    return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
  }

  const conditions = buildUserListConditions({ keyword, status, scopeFilter, userId });

  // 部门 ID 二次筛选（在已授权范围内叠加）
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

  const countResult = await db
    .select({ count: count() })
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
 * 获取单个用户详情（含角色列表与部门信息）
 *
 * 不使用缓存，确保详情数据实时性。
 * 调用方（Page / API Route）负责鉴权与数据范围检查。
 *
 * @param lookupId 用户 ID 或 publicId
 * @returns 用户详情对象，不存在时返回 null
 */
export async function getUser(lookupId: string) {
  const userRows = await db.select()
    .from(schema.users)
    .where(or(eq(schema.users.id, lookupId), eq(schema.users.publicId, lookupId)))
    .limit(1);
  const userRow = userRows[0];
  if (!userRow) return null;

  // 并行获取角色与部门信息
  const [roles, dept] = await Promise.all([
    db.select({
      id: schema.roles.id,
      publicId: schema.roles.publicId,
      code: schema.roles.code,
      name: schema.roles.name,
      description: schema.roles.description,
    }).from(schema.roles)
      .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.userRoles.userId, userRow.id)),
    userRow.deptId
      ? db.select().from(schema.departments).where(eq(schema.departments.id, userRow.deptId)).limit(1).then(r => r[0] ?? null)
      : null,
  ]);

  return {
    id: userRow.id,
    publicId: userRow.publicId,
    username: userRow.username,
    email: userRow.email,
    name: userRow.name,
    avatarUrl: userRow.avatarUrl,
    status: userRow.status,
    deptId: userRow.deptId,
    deptName: dept?.name || null,
    emailVerified: userRow.emailVerified,
    createdAt: userRow.createdAt.toISOString(),
    updatedAt: userRow.updatedAt?.toISOString() ?? null,
    lastLoginAt: userRow.lastLoginAt?.toISOString() ?? null,
    roles,
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

/**
 * 获取用户绑定的角色列表（含分配时间）
 */
export async function getUserRoles(lookupId: string) {
  return db.select({
    id: schema.roles.id,
    publicId: schema.roles.publicId,
    code: schema.roles.code,
    name: schema.roles.name,
    description: schema.roles.description,
    dataScopeType: schema.roles.dataScopeType,
    status: schema.roles.status,
    assignedAt: schema.userRoles.createdAt,
  })
    .from(schema.roles)
    .innerJoin(schema.userRoles, eq(schema.roles.id, schema.userRoles.roleId))
    .innerJoin(schema.users, eq(schema.userRoles.userId, schema.users.id))
    .where(or(eq(schema.users.id, lookupId), eq(schema.users.publicId, lookupId)))
    .orderBy(desc(schema.userRoles.createdAt));
}
