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
import { asc, and, eq, inArray } from 'drizzle-orm';
import type { EntityStatus } from '@auth-sso/contracts';
import { buildDepartmentTree } from '@/domain/department/department';
import type { DepartmentTreeNode } from '@/domain/department/department';
import { isScopeDenied } from '@/db/user-queries';
import { asEntityStatus } from '@/lib/type-guards';

/**
 * 获取当前授权范围内的部门树形结构
 *
 * @param deptIds — 由调用方在缓存作用域外通过 getUserRoleDeptIds(userId) 预先计算的部门 ID 列表
 * @param userId  — 当前操作者用户 ID（v3.2: 暂保留参数以维持接口兼容）
 */
export async function getDepartments(
  deptIds: string[],
  userId: string,
): Promise<DepartmentTreeNode[]> {
  'use cache';
  cacheLife('minutes');
  cacheTag('departments-list');

  if (isScopeDenied(deptIds)) {
    return [];
  }

  const rows = await db.select()
    .from(schema.departments)
    .where(inArray(schema.departments.id, deptIds))
    .orderBy(asc(schema.departments.sort), asc(schema.departments.createdAt));

  const depts = rows.map(r => ({
    id: r.id, parentId: r.parentId, ancestors: r.ancestors,
    name: r.name, code: r.code, sort: r.sort ?? 0,
    status: asEntityStatus(r.status),
    createdAt: Temporal.Instant.fromEpochMilliseconds(r.createdAt.getTime()),
  }));

  return buildDepartmentTree(depts);
}

/**
 * 按 ID 获取单个部门详情
 */
export async function getDepartmentById(lookupId: string) {
  const rows = await db.select().from(schema.departments)
    .where(eq(schema.departments.id, lookupId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
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
