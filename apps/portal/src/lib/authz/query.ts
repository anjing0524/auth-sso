import 'server-only';

/**
 * 数据范围读路径原语 — 把 Scope 变成 SQL 过滤条件
 *
 * 读路径的失效模式与写路径不同：写路径是 TOCTOU（快照过旧导致越权写入），
 * 读路径是 **fail-open**——过滤条件缺失时静默退化为"不过滤"，返回全表。
 *
 * 危险之处在于 Drizzle 的 `and()` 在无有效条件时返回 `undefined`，而
 * `where(undefined)` 不报错、不过滤。任何 `conditions.length > 0 ? and(...) : undefined`
 * 的形状都是潜在 fail-open（本仓库 `roles/data.ts` 曾因此返回全部部门的角色）。
 *
 * {@link scopeFilter} 保证**永远返回一个条件**：范围内 → `IN (...)`，
 * 空范围 → 恒假。调用方把它放进 `and(...)` 就不会再退化为不过滤。
 *
 * @module lib/authz/query
 */
import { inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { UserScope } from './data-scope';

/**
 * 把操作者范围编译为部门列过滤条件。
 *
 * @param scope  操作者数据范围（经 {@link resolveScope} 获取）
 * @param column 目标表的部门列（如 `schema.roles.deptId`）
 * @returns 范围非空 → `column IN (...)`；范围为空 → `FALSE`（恒假，绝不返回行）
 */
export function scopeFilter(scope: UserScope, column: PgColumn): SQL {
  if (scope.deptIds.length === 0) {
    // fail-closed：无可见部门时返回恒假条件，而非"无条件"
    return sql`FALSE`;
  }
  return inArray(column, [...scope.deptIds]);
}

/**
 * 范围为空时读模型应直接短路返回空集（避免无谓查询）。
 *
 * 语义与 {@link scopeFilter} 的恒假分支一致，只是把短路提前到查询之前。
 */
export function isScopeDenied(scope: UserScope): boolean {
  return scope.deptIds.length === 0;
}
