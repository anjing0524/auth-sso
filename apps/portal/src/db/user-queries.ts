/**
 * 用户列表查询共享模块 (Shared User List Query Helpers)
 *
 * 消除 data.ts 与 api/users/route.ts 之间 ~80 行重复的查询构建逻辑。
 * 两类读路径统一通过本模块组合查询条件与响应格式化。
 */
import { eq, ne, or, ilike, and } from 'drizzle-orm';
import { schema } from '@/infrastructure/db';
import { applyDataScopeFilter } from '@/lib/auth/data-scope';
import type { UserStatus } from '@auth-sso/contracts';
import { asUserStatus } from '@/lib/type-guards';

/**
 * 用户列表查询通用列选择（11 列 + deptName JOIN 字段）
 * 供 data.ts 和 route.ts 的 .select() 调用直接展开使用。
 */
export const USER_LIST_COLUMNS = {
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
};

/**
 * 构建用户列表 WHERE 过滤条件
 *
 * @returns 过滤条件数组（排除 DELETED + keyword + status + data scope）
 */
export function buildUserListConditions(params: {
  keyword: string;
  status: string;
  scopeFilter: { type: 'ALL' | 'LIST' | 'SELF'; deptIds?: string[] };
  userId: string;
}) {
  const { keyword, status, scopeFilter, userId } = params;

  // 默认排除逻辑删除的用户
  const conditions: ReturnType<typeof and>[] = [ne(schema.users.status, 'DELETED')];

  // 关键字搜索（三字段 ILIKE）
  if (keyword) {
    conditions.push(or(
      ilike(schema.users.name, `%${keyword}%`),
      ilike(schema.users.email, `%${keyword}%`),
      ilike(schema.users.username, `%${keyword}%`),
    ));
  }

  // 状态筛选
  if (status && status !== 'ALL') {
    conditions.push(eq(schema.users.status, asUserStatus(status)));
  }

  // 数据范围过滤
  const scopeSQL = applyDataScopeFilter(scopeFilter, schema.users.deptId, schema.users.id, userId);
  if (scopeSQL !== null && scopeSQL !== undefined) {
    conditions.push(scopeSQL);
  }

  return conditions;
}

/**
 * 判断数据范围过滤是否导致无权限访问
 */
export function isScopeDenied(scopeFilter: { type: 'ALL' | 'LIST' | 'SELF'; deptIds?: string[] }): boolean {
  return scopeFilter.type === 'LIST' && (scopeFilter.deptIds || []).length === 0;
}

