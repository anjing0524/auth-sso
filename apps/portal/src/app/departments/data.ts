/**
 * 部门管理读模型 (Read Model)
 *
 * 使用 "use cache" + cacheLife/cacheTag 实现持久化缓存。
 * 身份鉴权在缓存作用域外完成，userId 作为参数注入。
 * Drizzle 返回的 Date 通过 Temporal.Instant.fromEpochMilliseconds() 统一转换（支持 toJSON 序列化）。
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { asc, and, eq, or } from 'drizzle-orm';
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

/**
 * 按 ID 获取单个部门详情（支持内部 ID 和 publicId）
 */
export async function getDepartmentById(lookupId: string) {
  const rows = await db.select().from(schema.departments)
    .where(or(eq(schema.departments.id, lookupId), eq(schema.departments.publicId, lookupId)))
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
