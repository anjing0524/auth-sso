import 'server-only';

import { db, schema } from '@/infrastructure/db';
import { eq, ne, desc, count, inArray, and } from 'drizzle-orm';
import { USER_DELETED } from '@auth-sso/contracts';

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
 * @param deptIds 用户可访问的部门 ID 列表（含子树展开）
 */
export async function getDashboardStats(deptIds: string[]): Promise<DashboardStats> {
  const userWhere = deptIds.length > 0
    ? [ne(schema.users.status, USER_DELETED), inArray(schema.users.deptId, deptIds)]
    : [ne(schema.users.status, USER_DELETED)];

  const roleWhere = deptIds.length > 0
    ? [inArray(schema.roles.deptId, deptIds)]
    : [];

  const [[usersCount], [rolesCount], [clientsCount]] = await Promise.all([
    db.select({ count: count() }).from(schema.users).where(and(...userWhere)),
    db.select({ count: count() }).from(schema.roles).where(roleWhere.length > 0 ? and(...roleWhere) : undefined),
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
