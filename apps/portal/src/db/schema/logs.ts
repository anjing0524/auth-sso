/**
 * 审计与登录日志表 (Audit & Login Log Tables)
 *
 * - auditLogs：敏感操作审计（params 使用 jsonb，支持 DB 层 JSON 查询）
 * - loginLogs：登录事件日志
 *
 * ## 设计说明
 *
 * - userId / username 冗余存储，确保日志在用户被删除后仍可读（审计合规要求）
 * - userId 不设 FK 约束，避免阻塞用户删除操作
 * - 日志表为 append-only，不参与业务逻辑关联查询
 * - 不使用 status 枚举（与业务表不同），所有日志永久保留
 *
 * @module db/schema/logs
 */
import { pgTable, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';

/** 审计请求参数载荷（结构化 JSON） */
export type AuditParams = Record<string, unknown>;

/**
 * 操作审计日志表
 */
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  username: text('username'),
  operation: text('operation').notNull(),
  method: text('method'),
  url: text('url'),
  // 结构化 JSON 参数，替代旧的 text 存储
  params: jsonb('params').$type<AuditParams>(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  status: integer('status'),
  duration: integer('duration'),
  errorMsg: text('error_msg'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_audit_logs_user').on(t.userId),
  index('idx_audit_logs_created').on(t.createdAt),
]);

/**
 * 登录事件日志表
 */
export const loginLogs = pgTable('login_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  username: text('username').notNull(),
  eventType: text('event_type').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  location: text('location'),
  failReason: text('fail_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_login_logs_user').on(t.userId),
  index('idx_login_logs_created').on(t.createdAt),
]);
