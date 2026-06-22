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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paginatedSelect<T>(
  table: any,
  orderByColumn: any,
  conditions: ReturnType<typeof eq>[],
  params: PaginationParams,
  mapRow: (row: Record<string, unknown>) => T,
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
  if (params.startDate && DATE_REGEX.test(params.startDate)) {
    conditions.push(gte(schema.auditLogs.createdAt, new Date(`${params.startDate}T00:00:00`)));
  }
  if (params.endDate && DATE_REGEX.test(params.endDate)) {
    conditions.push(lte(schema.auditLogs.createdAt, new Date(`${params.endDate}T23:59:59.999`)));
  }

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
  if (params.startDate && DATE_REGEX.test(params.startDate)) {
    conditions.push(gte(schema.loginLogs.createdAt, new Date(`${params.startDate}T00:00:00`)));
  }
  if (params.endDate && DATE_REGEX.test(params.endDate)) {
    conditions.push(lte(schema.loginLogs.createdAt, new Date(`${params.endDate}T23:59:59.999`)));
  }

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
