/**
 * Schema 共享列构造器 (Shared Column Helpers)
 *
 * 独立模块，无跨表依赖，避免 drizzle-kit 加载时的循环初始化。
 *
 * v2 变更：timestamp → timestamptz（带时区）
 *
 * @module db/schema/helpers
 */
import { timestamp } from 'drizzle-orm/pg-core';

/**
 * 通用 created_at 列（带时区）
 */
export const createdAtColumn = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * 通用 updatedAt 自动刷新列（带时区）
 *
 * - 插入时 defaultNow()
 * - 更新时由 drizzle 的 $onUpdate 钩子自动刷新
 */
export const updatedAtColumn = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
