/**
 * 部门管理读模型 (Read Model)
 *
 * 使用 "use cache" + cacheLife/cacheTag 实现持久化缓存。
 * 身份鉴权在缓存作用域外完成，userId 作为参数注入。
 * Drizzle 返回的 Date 通过 Temporal.Instant.fromEpochMilliseconds() 统一转换为 Temporal 类型。
 */
import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { asc, and } from 'drizzle-orm';
import type { EntityStatus } from '@auth-sso/contracts';
import { getDataScopeFilter, applyDataScopeFilter } from '@/lib/auth';
import { buildDepartmentTree } from '@/domain/department/department';
import type { DepartmentTreeNode } from '@/domain/department/department';
import { isScopeDenied } from '@/db/user-queries';

/**
 * 获取当前授权范围内的部门树形结构
 */
export async function getDepartments(userId: string): Promise<DepartmentTreeNode[]> {
  'use cache';
  cacheLife('minutes');
  cacheTag('departments-list');

  const scopeFilter = await getDataScopeFilter(userId);

  if (isScopeDenied(scopeFilter)) {
    return [];
  }

  const conditions = [];
  const scopeSQL = applyDataScopeFilter(scopeFilter, schema.departments.id, schema.departments.id, userId);
  if (scopeSQL === null) return [];
  if (scopeSQL !== undefined) conditions.push(scopeSQL);

  const rows = await db.select()
    .from(schema.departments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(schema.departments.sort), asc(schema.departments.createdAt));

  // 构建树：只在 scopeFilter 限制范围内构建
  if (scopeFilter.type !== 'ALL') {
    // 有限范围时只返回平面列表
    return rows.map(r => ({
      id: r.id, publicId: r.publicId, parentId: r.parentId,
      name: r.name, code: r.code, sort: r.sort ?? 0,
      status: r.status as EntityStatus,
      createdAt: Temporal.Instant.fromEpochMilliseconds(r.createdAt.getTime()),
      children: [],
    }));
  }

  const depts = rows.map(r => ({
    id: r.id, publicId: r.publicId, parentId: r.parentId,
    name: r.name, code: r.code, sort: r.sort ?? 0,
    status: r.status as EntityStatus,
    createdAt: Temporal.Instant.fromEpochMilliseconds(r.createdAt.getTime()),
  }));

  return buildDepartmentTree(depts);
}
