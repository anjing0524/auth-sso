/**
 * 审计与登录日志表 (Audit & Login Log Tables)
 *
 * - auditLogs：敏感操作审计（params 使用 jsonb）
 * - loginLogs：登录事件日志
 *
 * ## 设计说明
 *
 * - userId / username 冗余存储，确保日志在用户被删除后仍可读（审计合规要求）
 * - userId 不设 FK 约束，避免阻塞用户删除操作
 * - 日志表为 append-only，不参与业务逻辑关联查询
 * - 不使用 status 枚举（与业务表不同），所有日志永久保留
 *
 * v2 变更：
 * - id text → uuid PK，默认 gen_random_uuid()
 * - operation → auditOperationEnum（替代裸 text）
 * - eventType → loginEventEnum（替代裸 text）
 * - ip text → varchar(45)（加长度约束，可 cast 为 inet）
 * - timestamp → timestamptz
 *
 * @module db/schema/logs
 */
import { pgTable, uuid, varchar, text, jsonb, smallint, integer, index } from 'drizzle-orm/pg-core';
import { loginEventEnum, auditOperationEnum } from './enums';
import { createdAtColumn } from './helpers';

/** 审计请求参数载荷（结构化 JSON） */
export type AuditParams = Record<string, unknown>;

/**
 * 操作审计日志表（append-only，无 FK）
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  username: varchar('username', { length: 50 }),
  operation: auditOperationEnum('operation').notNull(),
  method: varchar('method', { length: 10 }),
  url: varchar('url', { length: 500 }),
  params: jsonb('params').$type<AuditParams>(),
  ip: varchar('ip', { length: 45 }),
  userAgent: varchar('user_agent', { length: 500 }),
  status: smallint('status'),
  duration: integer('duration'),
  errorMsg: text('error_msg'),
  createdAt: createdAtColumn(),
}, (t) => [
  index('idx_audit_logs_user').on(t.userId),
  index('idx_audit_logs_created').on(t.createdAt),
  index('idx_audit_logs_operation').on(t.operation),
]);

/**
 * 登录事件日志表（append-only，无 FK）
 */
export const loginLogs = pgTable('login_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  username: varchar('username', { length: 50 }).notNull(),
  eventType: loginEventEnum('event_type').notNull(),
  ip: varchar('ip', { length: 45 }),
  userAgent: varchar('user_agent', { length: 500 }),
  location: varchar('location', { length: 100 }),
  failReason: text('fail_reason'),
  createdAt: createdAtColumn(),
}, (t) => [
  index('idx_login_logs_user').on(t.userId),
  index('idx_login_logs_created').on(t.createdAt),
  index('idx_login_logs_event_type').on(t.eventType),
]);
