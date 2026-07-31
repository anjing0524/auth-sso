import 'server-only';

import { db, schema } from '@/infrastructure/db';
import {
  eq,
  ne,
  desc,
  count,
  inArray,
  and,
  gt,
  isNull,
  countDistinct,
  gte,
} from 'drizzle-orm';
import { USER_DELETED } from '@auth-sso/contracts';
import { getShanghaiDayRange } from '@/lib/format-time';

export interface DashboardStats {
  users: number;
  onlineUsers: number;
  todayLogins: number;
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

  const now = new Date();
  const shanghaiToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const todayStart = getShanghaiDayRange(shanghaiToday).start;

  const [[usersCount], [onlineCount], [loginCount]] = await Promise.all([
    db.select({ count: count() }).from(schema.users).where(and(...userWhere)),
    db.select({ count: countDistinct(schema.refreshTokens.userId) })
      .from(schema.refreshTokens)
      .innerJoin(schema.users, eq(schema.refreshTokens.userId, schema.users.id))
      .where(and(
        gt(schema.refreshTokens.expiresAt, now),
        isNull(schema.refreshTokens.revoked),
        ...userWhere,
      )),
    db.select({ count: countDistinct(schema.loginLogs.userId) })
      .from(schema.loginLogs)
      .innerJoin(schema.users, eq(schema.loginLogs.userId, schema.users.id))
      .where(and(
        eq(schema.loginLogs.eventType, 'LOGIN_SUCCESS'),
        gte(schema.loginLogs.createdAt, todayStart),
        ...userWhere,
      )),
  ]);

  return {
    users: Number(usersCount?.count || 0),
    onlineUsers: Number(onlineCount?.count || 0),
    todayLogins: Number(loginCount?.count || 0),
  };
}

/**
 * 获取最近安全审计日志（最新 8 条）
 */
export async function getRecentAuditLogs(limit = 8): Promise<RecentAuditLog[]> {
  return db.select({
    id: schema.auditLogs.id,
    username: schema.auditLogs.username,
    operation: schema.auditLogs.operation,
    status: schema.auditLogs.status,
    createdAt: schema.auditLogs.createdAt,
  })
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
}
