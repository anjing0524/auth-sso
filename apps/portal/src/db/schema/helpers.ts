/**
 * Schema 共享列构造器 (Shared Column Helpers)
 *
 * 独立模块，无跨表依赖，避免 drizzle-kit 加载时的循环初始化。
 *
 * @module db/schema/helpers
 */
import { timestamp } from 'drizzle-orm/pg-core';

/**
 * 通用 updatedAt 自动刷新列
 *
 * - 插入时 defaultNow()
 * - 更新时由 drizzle 的 $onUpdate 钩子自动刷新，消除应用层手写 updatedAt 赋值
 */
export const updatedAtColumn = () =>
  timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
