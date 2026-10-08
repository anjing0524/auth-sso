import 'server-only';

import { db, schema } from '@/infrastructure/db';
import { eq, ne, desc, count, and } from 'drizzle-orm';
import { USER_DELETED } from '@auth-sso/contracts';
import { scopeFilter, isScopeDenied } from '@/lib/authz';
import type { UserScope } from '@/lib/authz';

export interface DashboardStats {
  users: number;
  roles: number;
  clients: number;
}

export interface RecentAuditLog {
  id: string;
  username: string | null;
  operation: string;
  status: number | null;
  createdAt: Date;
}

/**
 * 获取 Dashboard 核心指标（v3.2: 用户数和角色数按数据范围过滤）
 *
 * @param scope 操作者数据范围（在缓存作用域外经 `resolveScope` 获取）
 */
export async function getDashboardStats(scope: UserScope): Promise<DashboardStats> {
  // 无可见部门 → 全部计数为 0，而不是"不过滤"。
  // 原实现只在 deptIds 非空时追加范围条件，空范围会退化为统计全系统
  // （与 roles/data.ts 同源的 fail-open，见 ADR-014）。
  if (isScopeDenied(scope)) {
    return { users: 0, roles: 0, clients: 0 };
  }

  const userWhere = [ne(schema.users.status, USER_DELETED), scopeFilter(scope, schema.users.deptId)];
  const roleWhere = [scopeFilter(scope, schema.roles.deptId)];

  const [[usersCount], [rolesCount], [clientsCount]] = await Promise.all([
    db.select({ count: count() }).from(schema.users).where(and(...userWhere)),
    db.select({ count: count() }).from(schema.roles).where(and(...roleWhere)),
    db.select({ count: count() }).from(schema.clients),
  ]);

  return {
    users: Number(usersCount?.count || 0),
    roles: Number(rolesCount?.count || 0),
    clients: Number(clientsCount?.count || 0),
  };
}

/**
 * 获取最近安全审计日志（最新 8 条）
 */
export async function getRecentAuditLogs(limit = 8): Promise<RecentAuditLog[]> {
  return db.select({
    id: schema.auditLogs.id,
    username: schema.users.username,
    operation: schema.auditLogs.operation,
    status: schema.auditLogs.status,
    createdAt: schema.auditLogs.createdAt,
  })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.auditLogs.userId, schema.users.id))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
}
