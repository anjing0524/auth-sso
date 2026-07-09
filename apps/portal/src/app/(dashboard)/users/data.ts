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
import { eq, desc, and, count } from 'drizzle-orm';
import { canAccessDept, logServerDataRead } from '@/lib/auth';
import { ForbiddenError } from '@/domain/shared/errors';

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
  deptIds: string[],
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

  if (isScopeDenied(deptIds)) {
    return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
  }

  const conditions = buildUserListConditions({ keyword, status, deptIds, userId });

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
      status: u.status,
      name: u.name || u.username || 'Unknown',
      deptName: u.deptName || '未分配',
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * OIDC UserInfo 端点专用的轻量用户档案查询
 *
 * 仅返回 OIDC 标准字段（sub/name/email/picture/email_verified），
 * 不做角色/部门 JOIN，适合高频调用的 UserInfo 端点。
 *
 * @param userId 用户内部 ID（来自 JWT claims.sub）
 * @returns 用户档案，不存在时返回 null
 */
export async function getUserProfile(userId: string) {
  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 获取单个用户详情（含角色列表与部门信息）
 *
 * 不使用缓存，确保详情数据实时性。
 * 已内置底层越权校验（IDOR 防护）与访问日志（Access Log）自动记录。
 *
 * @param lookupId 用户 ID 或 publicId
 * @param deptIds  操作者数据范围（API Route 通过 JWT claims 传入；Server Component 自查询场景可不传，跳过数据范围检查）
 * @returns 用户详情对象，不存在时返回 null
 */
export async function getUser(lookupId: string, deptIds?: string[]) {
  // 使用 Relational Queries 一次性取出用户、角色、部门（FK 已建立，一次 DB 往返）
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, lookupId),
    with: {
      userRoles: { with: { role: true } },
      department: true,
    },
  });
  if (!user) return null;

  // 数据范围检查（deptIds 由调用方通过 JWT claims 传入，data.ts 不做鉴权）
  if (deptIds !== undefined && !canAccessDept(deptIds, user.deptId)) {
    throw new ForbiddenError('超出数据权限范围');
  }

  await logServerDataRead('user', lookupId);

  return {
    id: user.id,
    
    username: user.username,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    status: user.status,
    deptId: user.deptId,
    deptName: user.department?.name || null,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    // 投影为对外契约一致的扁平角色结构（DTO）
    roles: user.userRoles.map(ur => ({
      id: ur.role.id,
      
      code: ur.role.code,
      name: ur.role.name,
      description: ur.role.description,
    })),
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
 *
 * @param lookupId 用户 ID
 * @param deptIds  操作者数据范围（可选：API Route 传入；Server Component 自查询不传）
 */
export async function getUserRoles(lookupId: string, deptIds?: string[]) {
  // 使用 Relational Queries 一次性取出用户绑定的角色及分配时间
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, lookupId),
    with: {
      userRoles: {
        orderBy: (userRoles, { desc }) => [desc(userRoles.createdAt)],
        with: {
          role: true,
        },
      },
    },
  });

  if (!user) return [];

  // 数据范围检查（deptIds 由调用方通过 JWT claims 传入，data.ts 不做鉴权）
  if (deptIds !== undefined && !canAccessDept(deptIds, user.deptId)) {
    throw new ForbiddenError('超出数据权限范围');
  }
  await logServerDataRead('user_roles', lookupId);

  return user.userRoles
    .filter(ur => ur.role !== null)
    .map(ur => ({
      id: ur.role.id,

      code: ur.role.code,
      name: ur.role.name,
      description: ur.role.description,
      deptId: ur.role.deptId,
      status: ur.role.status,
      assignedAt: ur.createdAt,
    }));
}
