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
import { eq, desc, and, notExists, inArray, count, type SQL } from 'drizzle-orm';
import { USER_LIST_COLUMNS, buildUserListConditions } from '@/db/user-queries';
import { isScopeDenied, scopeFilter } from '@/lib/authz';
import type { UserScope } from '@/lib/authz';
import { paginationMeta, withPagination, countRows, offsetFor, normalizePagination } from '@/lib/pagination';

/** 列表行 → 列表项 DTO（日期序列化 + 展示名/部门名兜底）；泛型透传保留其余列 */
function toUserListItem<
  T extends {
    name: string | null;
    username: string;
    deptName: string | null;
    createdAt: Date;
    lastLoginAt: Date | null;
  },
>(u: T) {
  return {
    ...u,
    name: u.name || u.username || 'Unknown',
    deptName: u.deptName || '未分配',
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  };
}

/**
 * 分页与过滤获取用户列表
 *
 * @param userId 当前操作者用户 ID（调用方在缓存作用域外完成鉴权后注入）
 * @param params 分页与过滤参数
 * @returns 用户列表数据及分页信息（纯 JSON 可序列化）
 */
export async function getUsers(
  scope: UserScope,
  userId: string,
  params: {
    page: number;
    pageSize: number;
    keyword: string;
    status: string;
    /** 可选：按部门 ID 过滤（在数据范围已授权的基础上叠加筛选） */
    deptId?: string;
    /** 只看未分配角色的用户（工作台风险入口） */
    noRole?: boolean;
  }
) {
  'use cache';
  cacheLife('minutes');
  cacheTag('users-list');

  const { keyword, status, deptId, noRole } = params;
  // 非法页码在入口归一：LIMIT / OFFSET / 返回元信息三处共用同一值
  const { page, pageSize } = normalizePagination(params.page, params.pageSize);
  if (isScopeDenied(scope)) {
    return { data: [], pagination: paginationMeta(page, pageSize, 0) };
  }

  const conditions = buildUserListConditions({ keyword, status, scope, userId });
  // 部门 ID 二次筛选（在已授权范围内叠加）
  if (deptId) conditions.push(eq(schema.users.deptId, deptId));
  if (noRole) {
    conditions.push(notExists(
      db.select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, schema.users.id)),
    ));
  }
  const where = and(...conditions);

  const result = await withPagination(
    page,
    pageSize,
    db.select(USER_LIST_COLUMNS).from(schema.users)
      .leftJoin(schema.departments, eq(schema.users.deptId, schema.departments.id))
      .where(where).orderBy(desc(schema.users.createdAt))
      .limit(pageSize).offset(offsetFor(page, pageSize)),
    countRows(schema.users, where),
    toUserListItem,
  );

  // 列表需要"是否可登录"的信号：0 角色用户即使状态正常也无法登录门户。
  // 只聚合当前页，避免全表 JOIN 影响分页查询。
  const ids = result.data.map((u) => u.id);
  const roleCounts = ids.length === 0 ? [] : await db
    .select({ userId: schema.userRoles.userId, amount: count() })
    .from(schema.userRoles)
    .where(inArray(schema.userRoles.userId, ids))
    .groupBy(schema.userRoles.userId);
  const countByUser = new Map(roleCounts.map((r) => [r.userId, Number(r.amount)]));

  return {
    ...result,
    data: result.data.map((u) => ({ ...u, roleCount: countByUser.get(u.id) ?? 0 })),
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
      username: schema.users.username,
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
 * 一次往返取出用户 + 角色 + 部门（`getUser` / `getOwnUser` / `getUserRoles` 共用）。
 *
 * `where` 由调用方给出：**范围读口**必须传入含 `scopeFilter` 的条件，**身份读口**
 * 只传主键。把条件做成入参而非"可选的范围参数"，是为了让"有范围"在调用处显式可见
 * ——可选范围参数正是 ADR-014 记录过的 fail-open 形状（省略即不过滤）。
 */
function findUserWithRoles(where: SQL | undefined) {
  return db.query.users.findFirst({
    where,
    with: {
      userRoles: { with: { role: true } },
      department: true,
    },
  });
}

type UserWithRolesRow = NonNullable<Awaited<ReturnType<typeof findUserWithRoles>>>;

/** 角色绑定行 → 对外契约一致的扁平角色 DTO */
function toRoleDTO(ur: NonNullable<UserWithRolesRow['userRoles'][number]>) {
  return {
    id: ur.role.id,
    code: ur.role.code,
    name: ur.role.name,
    description: ur.role.description,
  };
}

/** 用户详情行 → 详情 DTO（日期序列化 + 部门名投影 + 角色扁平化） */
function toUserDetail(user: UserWithRolesRow) {
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
    roles: user.userRoles.map(toRoleDTO),
  };
}

/**
 * 获取单个用户详情（含角色列表与部门信息）——**范围读口**。
 *
 * 范围约束在 SQL 内施加：范围外与不存在同形返回 `null`，读路径不用状态码区分
 * 存在性（ADR-014 实施顺序第 3 步）。访问日志由调用方记录，本 module 不知道
 * HTTP 存在——此前 JSDoc 声称"已内置 IDOR 防护与访问日志"，两件事都不在函数体里，
 * 而页面详情路径正因这句谎话把范围判定漏掉了。
 *
 * 不使用缓存，确保详情数据实时性。
 *
 * @param lookupId 用户 ID
 * @param scope 操作者数据范围（经 `resolveScope` 获取）
 * @returns 用户详情；不存在或超出范围时为 null
 */
export async function getUser(lookupId: string, scope: UserScope) {
  if (isScopeDenied(scope)) return null;
  const user = await findUserWithRoles(
    and(eq(schema.users.id, lookupId), scopeFilter(scope, schema.users.deptId)),
  );
  return user ? toUserDetail(user) : null;
}

/**
 * 获取**自己**的用户详情——身份读口，不受数据范围约束。
 *
 * 存在两个读口的理由不是对称性而是必要性：操作者的可见范围来自其角色的部门子树，
 * 而本人的 `dept_id` 完全可能落在该子树之外（角色部门与本人所属部门不同）。
 * 若让 `/api/me`、`/profile`、dashboard 侧边栏走范围读口，这些用户会读不到自己。
 *
 * @param userId 身份来源的用户 ID（来自 `resolveIdentity`，不是 URL 参数）
 * @returns 用户详情；不存在时为 null
 */
export async function getOwnUser(userId: string) {
  const user = await findUserWithRoles(eq(schema.users.id, userId));
  return user ? toUserDetail(user) : null;
}

/**
 * 获取可选部门列表（用于 users / roles 页面的部门下拉）——**范围读口**。
 *
 * 同样收 scope：此前它没有任何范围参数，于是范围受限的管理员在下拉里能看到
 * 全部部门（含范围外部门的名称与 ID），与 H-ACL-002 属同一形态。
 *
 * @param scope 操作者数据范围（经 `resolveScope` 获取）
 */
export async function getDepartmentOptions(scope: UserScope) {
  'use cache';
  cacheLife('hours');
  cacheTag('departments');

  if (isScopeDenied(scope)) return [];

  return await db
    .select({ id: schema.departments.id, name: schema.departments.name })
    .from(schema.departments)
    .where(scopeFilter(scope, schema.departments.id))
    .orderBy(schema.departments.name);
}

/** 角色 + 所属部门 + 分配时间 DTO */
interface AssignedRole {
  id: string;
  code: string;
  name: string;
  description: string | null;
  deptId: string | null;
  status: string;
  assignedAt: Date;
}

/** 用户-角色绑定行 → AssignedRole */
function toAssignedRole(ur: {
  role: { id: string; code: string; name: string; description: string | null; deptId: string | null; status: string };
  createdAt: Date;
}): AssignedRole {
  return {
    id: ur.role.id,
    code: ur.role.code,
    name: ur.role.name,
    description: ur.role.description,
    deptId: ur.role.deptId,
    status: ur.role.status,
    assignedAt: ur.createdAt,
  };
}

/**
 * 获取用户绑定的角色列表（含分配时间）——**范围读口**。
 *
 * 返回值区分"不可见"与"可见但无角色"：前者 null（调用方映射为 404），
 * 后者 `[]`（合法的空列表）。此前不存在时返回 `[]`，使这两种情况无法区分。
 *
 * @param lookupId 用户 ID
 * @param scope 操作者数据范围（经 `resolveScope` 获取）
 * @returns 角色列表；不存在或超出范围时为 null
 */
export async function getUserRoles(
  lookupId: string,
  scope: UserScope,
): Promise<AssignedRole[] | null> {
  if (isScopeDenied(scope)) return null;

  // 使用 Relational Queries 一次性取出用户绑定的角色及分配时间
  const user = await db.query.users.findFirst({
    where: and(eq(schema.users.id, lookupId), scopeFilter(scope, schema.users.deptId)),
    with: {
      userRoles: {
        orderBy: (userRoles, { desc }) => [desc(userRoles.createdAt)],
        with: { role: true },
      },
    },
  });

  if (!user) return null;

  return user.userRoles.filter(ur => ur.role !== null).map(toAssignedRole);
}
