/**
 * 日志表 (Log Tables)
 *
 * - auditLogs：写操作审计（CREATE/UPDATE/DELETE/REVOKE），合规追溯，append-only 永久
 * - loginLogs：登录事件日志，安全分析，append-only 永久
 * - accessLogs：读操作访问日志（GET LIST/READ），合规追溯，月分区 180 天保留
 *
 * ## 设计说明
 *
 * - userId / username 冗余存储，确保日志在用户被删除后仍可读（审计合规要求）
 * - userId 不设 FK 约束，避免阻塞用户删除操作
 * - audit/login/access 日志表为 append-only，不参与业务逻辑关联查询
 *
 * v2 变更：
 * - id text → uuid PK，默认 gen_random_uuid()
 * - operation → auditOperationEnum（替代裸 text）
 * - eventType → loginEventEnum（替代裸 text）
 * - ip → inet
 * - timestamp → timestamptz
 *
 * @module db/schema/logs
 */
import { pgTable, uuid, varchar, text, inet, jsonb, smallint, integer, index } from 'drizzle-orm/pg-core';
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
  ip: inet('ip'),
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
  ip: inet('ip'),
  userAgent: varchar('user_agent', { length: 500 }),
  location: varchar('location', { length: 100 }),
  failReason: text('fail_reason'),
  createdAt: createdAtColumn(),
}, (t) => [
  index('idx_login_logs_user').on(t.userId),
  index('idx_login_logs_created').on(t.createdAt),
  index('idx_login_logs_event_type').on(t.eventType),
  // 复合索引：暴力破解防护 DB 回退查询（userId + eventType + createdAt）高频使用
  index('idx_login_logs_user_event_created').on(t.userId, t.eventType, t.createdAt),
]);

/**
 * 访问日志表（读操作审计，append-only，无 FK）
 *
 * 记录所有 GET 敏感数据访问（如查看用户详情、角色详情）。
 * 生产环境按月分区（PARTITION BY RANGE created_at），保留 180 天。
 * Drizzle schema 仅用于类型推导；实际分区表由 0004 migration 手动创建。
 */
export const accessLogs = pgTable('access_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  username: varchar('username', { length: 50 }),
  method: varchar('method', { length: 10 }).notNull(),
  path: varchar('path', { length: 500 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: varchar('resource_id', { length: 64 }),
  ip: inet('ip'),
  userAgent: varchar('user_agent', { length: 500 }),
  status: smallint('status'),
  duration: integer('duration'),
  createdAt: createdAtColumn(),
}, (t) => [
  index('idx_access_logs_user').on(t.userId),
  index('idx_access_logs_created').on(t.createdAt),
  index('idx_access_logs_resource').on(t.resourceType, t.resourceId),
]);


