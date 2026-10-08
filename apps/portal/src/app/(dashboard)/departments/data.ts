/**
 * 部门管理读模型 (Read Model)
 *
 * 使用 "use cache" + cacheLife/cacheTag 实现持久化缓存。
 * scopeFilter 由调用方在缓存作用域外计算后注入（R10 / §3.6），
 * 严禁在 'use cache' 作用域内访问 headers()/cookies() 等动态 API。
 * Drizzle 返回的 Date 直接使用（无需 Temporal 转换）。
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { asc, eq, and } from 'drizzle-orm';
import { buildDepartmentTree, departmentFromPersistence } from '@/domain/department/department';
import type { DepartmentTreeNode } from '@/domain/department/department';
import { scopeFilter, isScopeDenied } from '@/lib/authz';
import type { UserScope } from '@/lib/authz';
import { asEntityStatus } from '@/lib/type-guards';


/** departments 行 → 领域实体（sort 兜底 + 状态守护） */
function toDomainDepartment(r: typeof schema.departments.$inferSelect) {
  return departmentFromPersistence({
    id: r.id, parentId: r.parentId, ancestors: r.ancestors,
    name: r.name, code: r.code, sort: r.sort ?? 0,
    status: asEntityStatus(r.status),
    createdAt: r.createdAt,
  });
}

/**
 * 获取当前授权范围内的部门树形结构
 *
 * @param scope  操作者数据范围（在缓存作用域**外**经 `resolveScope` 获取）
 * @param userId 当前操作者用户 ID（v3.2: 暂保留参数以维持接口兼容）
 */
export async function getDepartments(
  scope: UserScope,
  _userId: string,
): Promise<DepartmentTreeNode[]> {
  'use cache';
  cacheLife('minutes');
  cacheTag('departments-list');

  if (isScopeDenied(scope)) {
    return [];
  }

  const rows = await db.select()
    .from(schema.departments)
    .where(scopeFilter(scope, schema.departments.id))
    .orderBy(asc(schema.departments.sort), asc(schema.departments.createdAt));

  return buildDepartmentTree(rows.map(toDomainDepartment));
}

/**
 * 按 ID 获取单个部门详情
 *
 * @param lookupId 部门 ID
 * @param scope    操作者数据范围。**必填**：不可省略——省略即无范围约束，
 *                 会静默返回任意部门的详情（此前的 JSDoc 声称有该参数但签名
 *                 里并不存在，属 fail-open 隐患，见 ADR-014）。
 * @returns 部门不存在或不在范围内 → null（调用方据此返回 404）
 */
export async function getDepartmentById(lookupId: string, scope: UserScope) {
  const rows = await db.select().from(schema.departments)
    .where(and(eq(schema.departments.id, lookupId), scopeFilter(scope, schema.departments.id)))
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
    createdAt: row.createdAt,
  };
}

/**
 * 获取部门下的成员列表
 *
 * 成员必须在操作者数据范围内——范围约束与部门约束同为查询条件，
 * 不能只在调用方校验部门后即信任（见 ADR-014）。
 *
 * @param departmentId 部门 ID
 * @param scope        操作者数据范围（必填，理由同 {@link getDepartmentById}）
 */
export async function getDepartmentMembers(departmentId: string, scope: UserScope) {
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
    .where(and(
      eq(schema.users.deptId, departmentId),
      scopeFilter(scope, schema.users.deptId),
    ));
}
