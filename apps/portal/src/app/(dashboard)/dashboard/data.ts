import 'server-only';

import { db, schema } from '@/infrastructure/db';
import { eq, ne, desc, count, and, gte, inArray, isNull } from 'drizzle-orm';
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

export interface LoginSummary {
  success: number;
  failed: number;
}

/**
 * 近 7 日登录概览（成功/失败）。
 *
 * 登录日志是安全敏感数据：调用方必须先具备 audit:read（页面层门禁），
 * 这里只返回聚合计数，不返回明细。
 */
export async function getLoginSummary7d(): Promise<LoginSummary> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ eventType: schema.loginLogs.eventType, value: count() })
    .from(schema.loginLogs)
    .where(and(gte(schema.loginLogs.createdAt, since), inArray(schema.loginLogs.eventType, ['LOGIN_SUCCESS', 'LOGIN_FAILED'])))
    .groupBy(schema.loginLogs.eventType);
  const byType = new Map(rows.map((r) => [r.eventType, Number(r.value ?? 0)]));
  return {
    success: byType.get('LOGIN_SUCCESS') ?? 0,
    failed: byType.get('LOGIN_FAILED') ?? 0,
  };
}


export interface DashboardRisks {
  /** 活跃但未分配任何角色的用户 */
  usersWithoutRoles: number;
  /** 没有任何权限的角色（空壳角色） */
  rolesWithoutPermissions: number;
  /** 已禁用但仍在列表中的应用 */
  disabledClients: number;
}

/**
 * 工作台“需要关注”：只返回聚合计数，明细通过对应列表筛选页查看。
 * 用户/角色按数据范围过滤；应用为全局资源（与 stats.clients 同口径）。
 */
export async function getDashboardRisks(scope: UserScope): Promise<DashboardRisks> {
  if (isScopeDenied(scope)) {
    return { usersWithoutRoles: 0, rolesWithoutPermissions: 0, disabledClients: 0 };
  }
  const [[u], [r], [c]] = await Promise.all([
    db.select({ count: count() })
      .from(schema.users)
      .leftJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .where(and(
        ne(schema.users.status, USER_DELETED),
        isNull(schema.users.deletedAt),
        isNull(schema.userRoles.userId),
        scopeFilter(scope, schema.users.deptId),
      )),
    db.select({ count: count() })
      .from(schema.roles)
      .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
      .where(and(isNull(schema.rolePermissions.roleId), scopeFilter(scope, schema.roles.deptId))),
    db.select({ count: count() }).from(schema.clients).where(eq(schema.clients.status, 'DISABLED')),
  ]);
  return {
    usersWithoutRoles: Number(u?.count ?? 0),
    rolesWithoutPermissions: Number(r?.count ?? 0),
    disabledClients: Number(c?.count ?? 0),
  };
}
