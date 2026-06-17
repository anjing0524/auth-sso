/**
 * 审计日志读模型 (Read Model)
 *
 * 提供操作审计日志和登录日志的分页查询。
 * 不使用缓存（审计数据变化频繁且安全性要求高）。
 */
import 'server-only';

import { db, schema } from '@/infrastructure/db';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';

/** 日期格式正则：防止 SQL 注入和异常参数穿透 */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function clamp(val: number, min: number, max: number) {
  return isNaN(val) || val < min ? min : val > max ? max : val;
}

/**
 * 分页获取操作审计日志
 */
export async function getAuditLogs(params: {
  page: number;
  pageSize: number;
  userId?: string;
  operation?: string;
  startDate?: string;
  endDate?: string;
}) {
  const page = clamp(params.page, 1, Infinity);
  const pageSize = clamp(params.pageSize, 1, 100);
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (params.userId) conditions.push(eq(schema.auditLogs.userId, params.userId));
  if (params.operation) conditions.push(eq(schema.auditLogs.operation, params.operation));
  if (params.startDate && DATE_REGEX.test(params.startDate)) {
    conditions.push(gte(schema.auditLogs.createdAt, new Date(`${params.startDate}T00:00:00`)));
  }
  if (params.endDate && DATE_REGEX.test(params.endDate)) {
    conditions.push(lte(schema.auditLogs.createdAt, new Date(`${params.endDate}T23:59:59.999`)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db.select({ count: sql`COUNT(*)::int` })
    .from(schema.auditLogs).where(whereClause);
  const total = Number(countResult[0]?.count ?? 0);

  const logs = await db.select()
    .from(schema.auditLogs)
    .where(whereClause)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    data: logs.map(log => ({
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
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * 分页获取登录日志
 */
export async function getLoginLogs(params: {
  page: number;
  pageSize: number;
  userId?: string;
  eventType?: string;
  startDate?: string;
  endDate?: string;
}) {
  const page = clamp(params.page, 1, Infinity);
  const pageSize = clamp(params.pageSize, 1, 100);
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (params.userId) conditions.push(eq(schema.loginLogs.userId, params.userId));
  if (params.eventType) conditions.push(eq(schema.loginLogs.eventType, params.eventType));
  if (params.startDate && DATE_REGEX.test(params.startDate)) {
    conditions.push(gte(schema.loginLogs.createdAt, new Date(`${params.startDate}T00:00:00`)));
  }
  if (params.endDate && DATE_REGEX.test(params.endDate)) {
    conditions.push(lte(schema.loginLogs.createdAt, new Date(`${params.endDate}T23:59:59.999`)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db.select({ count: sql`COUNT(*)::int` })
    .from(schema.loginLogs).where(whereClause);
  const total = Number(countResult[0]?.count ?? 0);

  const logs = await db.select()
    .from(schema.loginLogs)
    .where(whereClause)
    .orderBy(desc(schema.loginLogs.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    data: logs.map(log => ({
      id: log.id,
      userId: log.userId,
      username: log.username,
      eventType: log.eventType,
      ip: log.ip,
      userAgent: log.userAgent,
      location: log.location,
      failReason: log.failReason,
      createdAt: log.createdAt,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
