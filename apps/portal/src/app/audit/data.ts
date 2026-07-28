/**
 * 审计日志读模型 (Read Model)
 *
 * 提供操作审计日志和登录日志的分页查询。
 * 不使用缓存（审计数据变化频繁且安全性要求高）。
 */
import 'server-only';

import { db, schema } from '@/infrastructure/db';
import { eq, desc, and, gte, lte, count } from 'drizzle-orm';
import type { AuditOperation, LoginEventType } from '@auth-sso/contracts';

/** 日期格式正则：防止 SQL 注入和异常参数穿透 */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 为分页查询构建日期范围过滤条件 — 消除 getAuditLogs / getLoginLogs / getAccessLogs 三处重复
 */
function addDateRangeConditions(
  conditions: ReturnType<typeof eq>[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column: any,
  startDate?: string,
  endDate?: string,
): void {
  if (startDate && DATE_REGEX.test(startDate)) {
    conditions.push(gte(column, new Date(`${startDate}T00:00:00`)));
  }
  if (endDate && DATE_REGEX.test(endDate)) {
    conditions.push(lte(column, new Date(`${endDate}T23:59:59.999`)));
  }
}

function clamp(val: number, min: number, max: number) {
  return isNaN(val) || val < min ? min : val > max ? max : val;
}

interface PaginationParams {
  page: number;
  pageSize: number;
}

interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

/**
 * 通用分页查询 — 消除 getAuditLogs / getLoginLogs 之间 ~50 行重复模板
 * 使用 any 透传以兼容 Drizzle 各表的强类型（内部辅助函数）
 */
 
async function paginatedSelect<T>(
  table: any,
  orderByColumn: any,
  conditions: ReturnType<typeof eq>[],
  params: PaginationParams,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapRow: (row: any) => T,
): Promise<PaginatedResult<T>> {
  const page = clamp(params.page, 1, Infinity);
  const pageSize = clamp(params.pageSize, 1, 100);
  const offset = (page - 1) * pageSize;

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db.select({ count: count() })
    .from(table).where(whereClause);
  const total = Number(countResult[0]?.count ?? 0);

  const rows = await db.select()
    .from(table)
    .where(whereClause)
    .orderBy(desc(orderByColumn))
    .limit(pageSize)
    .offset(offset);

  return {
    data: rows.map(r => mapRow(r as unknown as Record<string, unknown>)),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * 分页获取操作审计日志
 */
export async function getAuditLogs(params: PaginationParams & {
  userId?: string;
  operation?: AuditOperation;
  startDate?: string;
  endDate?: string;
}) {
  const conditions: ReturnType<typeof eq>[] = [];
  if (params.userId) conditions.push(eq(schema.auditLogs.userId, params.userId));
  if (params.operation) conditions.push(eq(schema.auditLogs.operation, params.operation));
  addDateRangeConditions(conditions, schema.auditLogs.createdAt, params.startDate, params.endDate);

  return paginatedSelect(schema.auditLogs, schema.auditLogs.createdAt, conditions, params, (log) => ({
    id: log.id,
    userId: log.userId,
    username: log.username,
    operation: log.operation,
    method: log.method,
    url: log.url,
    params: log.params,
    ip: log.ip,
    userAgent: log.userAgent,
    status: log.status,
    duration: log.duration,
    errorMsg: log.errorMsg,
    createdAt: log.createdAt,
  }));
}

/**
 * 分页获取登录日志
 */
export async function getLoginLogs(params: PaginationParams & {
  userId?: string;
  eventType?: LoginEventType;
  startDate?: string;
  endDate?: string;
}) {
  const conditions: ReturnType<typeof eq>[] = [];
  if (params.userId) conditions.push(eq(schema.loginLogs.userId, params.userId));
  if (params.eventType) conditions.push(eq(schema.loginLogs.eventType, params.eventType));
  addDateRangeConditions(conditions, schema.loginLogs.createdAt, params.startDate, params.endDate);

  return paginatedSelect(schema.loginLogs, schema.loginLogs.createdAt, conditions, params, (log) => ({
    id: log.id,
    userId: log.userId,
    username: log.username,
    eventType: log.eventType,
    ip: log.ip,
    userAgent: log.userAgent,
    location: log.location,
    failReason: log.failReason,
    createdAt: log.createdAt,
  }));
}

/**
 * 分页获取访问日志（读操作合规追溯）
 *
 * 用于回答"谁查看了哪条敏感数据"。复用 audit:read 权限（不新建权限码）。
 */
export async function getAccessLogs(params: PaginationParams & {
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const conditions: ReturnType<typeof eq>[] = [];
  if (params.userId) conditions.push(eq(schema.accessLogs.userId, params.userId));
  if (params.resourceType) conditions.push(eq(schema.accessLogs.resourceType, params.resourceType));
  if (params.resourceId) conditions.push(eq(schema.accessLogs.resourceId, params.resourceId));
  addDateRangeConditions(conditions, schema.accessLogs.createdAt, params.startDate, params.endDate);

  return paginatedSelect(schema.accessLogs, schema.accessLogs.createdAt, conditions, params, (log) => ({
    id: log.id,
    userId: log.userId,
    username: log.username,
    method: log.method,
    path: log.path,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    ip: log.ip,
    userAgent: log.userAgent,
    status: log.status,
    duration: log.duration,
    createdAt: log.createdAt,
  }));
}
