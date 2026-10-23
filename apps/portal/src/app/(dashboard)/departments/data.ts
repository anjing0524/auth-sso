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
import { asc, count, eq, and, inArray } from 'drizzle-orm';
import { departmentFromPersistence } from '@/domain/department/department';
import { buildTree } from '@/domain/shared/tree-utils';
import { scopeFilter, isScopeDenied } from '@/lib/authz';
import type { UserScope } from '@/lib/authz';
import { asEntityStatus } from '@/lib/type-guards';


/**
 * 部门树的可序列化 DTO —— **缓存边界内只允许 plain 值**。
 *
 * `"use cache"` 会序列化返回值：领域实体的 `createdAt: Temporal.Instant` 不是 plain
 * object，Next 会报 `Only plain objects can be passed to Client Components … Cache …
 * Temporal.Instant objects are not supported`（审计 P2-9）。因此在缓存内部就收敛成
 * ISO 字符串 + 扁平字段，再由页面/接口消费。
 */
export interface DepartmentTreeDto {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  sort: number;
  status: string;
  createdAt: string;
  children: DepartmentTreeDto[];
}

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
): Promise<DepartmentTreeDto[]> {
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

  // 领域实体只用于做状态/排序归一，随后立刻收敛为 plain DTO（见文件头注释）
  const flat: Omit<DepartmentTreeDto, 'children'>[] = rows.map((row) => {
    const domain = toDomainDepartment(row);
    return {
      id: domain.id,
      parentId: domain.parentId,
      name: domain.name,
      code: domain.code,
      sort: domain.sort,
      status: domain.status,
      createdAt: row.createdAt.toISOString(),
    };
  });
  return buildTree(flat, 'id', 'parentId', 'sort') as DepartmentTreeDto[];
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

/** 删除确认的影响面（U-DEP05）：某个部门下的直接依赖数量 */
export interface DepartmentDeletionStats {
  /** 直接子部门数 */
  childCount: number;
  /** 直属用户数（含软删，与服务端删除守卫 `count(*)` 同口径） */
  userCount: number;
  /** 关联角色数 */
  roleCount: number;
}

/**
 * 批量统计部门删除影响面（子部门 / 直属用户 / 角色）。
 *
 * 与服务端 `deleteDepartmentAction` 的三个守卫**同口径**：任一非 0 时删除会被拒，
 * 因此确认弹窗展示的是"为什么删不了"的真实数字（而不是泛泛的"请确认"）。
 *
 * @param deptIds 当前可见部门 ID 列表（空数组 → 空对象，零查询）
 */
export async function getDepartmentDeletionStats(
  deptIds: readonly string[],
): Promise<Record<string, DepartmentDeletionStats>> {
  if (deptIds.length === 0) return {};
  const [children, users, roles] = await Promise.all([
    db.select({ deptId: schema.departments.parentId, amount: count() })
      .from(schema.departments)
      .where(inArray(schema.departments.parentId, [...deptIds]))
      .groupBy(schema.departments.parentId),
    db.select({ deptId: schema.users.deptId, amount: count() })
      .from(schema.users)
      .where(inArray(schema.users.deptId, [...deptIds]))
      .groupBy(schema.users.deptId),
    db.select({ deptId: schema.roles.deptId, amount: count() })
      .from(schema.roles)
      .where(inArray(schema.roles.deptId, [...deptIds]))
      .groupBy(schema.roles.deptId),
  ]);
  const stats: Record<string, DepartmentDeletionStats> = {};
  for (const id of deptIds) stats[id] = { childCount: 0, userCount: 0, roleCount: 0 };
  for (const row of children) if (row.deptId) stats[row.deptId]!.childCount = Number(row.amount);
  for (const row of users) if (row.deptId) stats[row.deptId]!.userCount = Number(row.amount);
  for (const row of roles) stats[row.deptId]!.roleCount = Number(row.amount);
  return stats;
}
