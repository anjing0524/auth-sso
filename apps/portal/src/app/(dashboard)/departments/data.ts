/**
 * 部门管理读模型 (Read Model)
 *
 * 使用 "use cache" + cacheLife/cacheTag 实现持久化缓存。
 * scopeFilter 由调用方在缓存作用域外计算后注入（R10 / §3.6），
 * 严禁在 'use cache' 作用域内访问 headers()/cookies() 等动态 API。
 * Drizzle 返回的 Date 通过 Temporal.Instant.fromEpochMilliseconds() 统一转换（支持 toJSON 序列化）。
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { asc, and, eq } from 'drizzle-orm';
import { byIdOrPublicId } from '@/db/resolve-id';
import type { EntityStatus } from '@auth-sso/contracts';
import { applyDataScopeFilter } from '@/lib/auth';
import { buildDepartmentTree } from '@/domain/department/department';
import type { DepartmentTreeNode } from '@/domain/department/department';
import { isScopeDenied } from '@/db/user-queries';
import { asEntityStatus } from '@/lib/type-guards';

/**
 * 获取当前授权范围内的部门树形结构
 *
 * @param scopeFilter — 由调用方在缓存作用域外通过 getDataScopeFilter(userId) 预先计算的过滤条件
 * @param userId       — 当前操作者用户 ID（用于范围过滤）
 */
export async function getDepartments(
  scopeFilter: { type: 'ALL' | 'LIST' | 'SELF'; deptIds?: string[] },
  userId: string,
): Promise<DepartmentTreeNode[]> {
  'use cache';
  cacheLife('minutes');
  cacheTag('departments-list');

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
      id: r.id, publicId: r.publicId, parentId: r.parentId, ancestors: r.ancestors,
      name: r.name, code: r.code, sort: r.sort ?? 0,
      status: asEntityStatus(r.status),
      createdAt: Temporal.Instant.fromEpochMilliseconds(r.createdAt.getTime()),
      children: [],
    }));
  }

  const depts = rows.map(r => ({
    id: r.id, publicId: r.publicId, parentId: r.parentId, ancestors: r.ancestors,
    name: r.name, code: r.code, sort: r.sort ?? 0,
    status: asEntityStatus(r.status),
    createdAt: Temporal.Instant.fromEpochMilliseconds(r.createdAt.getTime()),
  }));

  return buildDepartmentTree(depts);
}

/**
 * 按 ID 获取单个部门详情（支持内部 ID 和 publicId）
 */
export async function getDepartmentById(lookupId: string) {
  const rows = await db.select().from(schema.departments)
    .where(byIdOrPublicId('departments', lookupId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.publicId,
    parentId: row.parentId,
    name: row.name,
    code: row.code,
    sort: row.sort ?? 0,
    status: row.status,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 获取部门下的成员列表
 */
export async function getDepartmentMembers(departmentId: string) {
  return db.select({
    id: schema.users.id,
    publicId: schema.users.publicId,
    name: schema.users.name,
    username: schema.users.username,
    email: schema.users.email,
    avatarUrl: schema.users.avatarUrl,
    status: schema.users.status,
    createdAt: schema.users.createdAt,
  })
    .from(schema.users)
    .where(eq(schema.users.deptId, departmentId));
}
