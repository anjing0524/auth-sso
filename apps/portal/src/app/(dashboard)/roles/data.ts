/**
 * 角色管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, ilike, inArray, or, asc, desc, and, count, getTableColumns, isNull } from 'drizzle-orm';

import { scopeFilter, isScopeDenied } from '@/lib/authz';
import type { UserScope } from '@/lib/authz';
import { asEntityStatus } from '@/lib/type-guards';
import type { EntityStatus } from '@auth-sso/contracts';
import { paginationMeta, withPagination, countRows, offsetFor, normalizePagination } from '@/lib/pagination';

/** 角色行 → 列表/详情 DTO（isSystem/sort 兜底 + 日期序列化），列表与详情共用 */
function toRoleDTO(r: {
  id: string; name: string; code: string; description: string | null;
  deptId: string; isSystem: boolean | null; status: EntityStatus;
  sort: number | null; createdAt: Date;
}) {
  return {
    id: r.id, name: r.name, code: r.code,
    description: r.description, deptId: r.deptId,
    isSystem: r.isSystem ?? false, status: r.status, sort: r.sort ?? 0,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * 角色列表过滤条件：部门范围（H-ACL-002）+ 关键字 + 状态
 *
 * `deptIds` 为必填且必须非空（空范围是"无权限"，由调用方先行短路）。
 * 此处仍对空数组兜底 `sql\`FALSE\``：安全约束必须在 SQL 层始终存在，
 * 不能依赖调用方——`and()` 在无有效条件时返回 undefined，会静默退化成全表查询。
 */
function buildRoleConditions(keyword: string, status: string, scope: UserScope, deptId?: string) {
  const conditions = [];
  // 数据范围过滤：由 scopeFilter 统一施加（空范围恒 FALSE）
  conditions.push(scopeFilter(scope, schema.roles.deptId));
  if (keyword) {
    conditions.push(or(
      ilike(schema.roles.name, `%${keyword}%`),
      ilike(schema.roles.code, `%${keyword}%`),
    ));
  }
  if (status) {
    conditions.push(eq(schema.roles.status, asEntityStatus(status)));
  }
  if (deptId) {
    conditions.push(eq(schema.roles.deptId, deptId));
  }
  // 使用 COUNT(*) 聚合查询，避免拉取全部 ID 到内存再统计
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * 分页获取角色列表
 *
 * @param params.scope 操作者数据范围（必填，数据范围控制）
 */
export interface RolesListParams {
  page: number;
  pageSize: number;
  keyword: string;
  status: string;
  /** 部门筛选（可选，必须仍在 scope 内） */
  deptId?: string;
  /**
   * 操作者数据范围（必填）。
   *
   * 刻意不设为可选：可选参数会让"忘记传范围"编译通过并静默返回全部角色，
   * 而省略与传空数组在语义上完全不同（后者是"无权限"，前者是"不过滤"）。
   */
  scope: UserScope;
  /** 列表排序：permissions-asc/desc = 按权限数（空壳角色优先/高权优先） */
  sort?: 'permissions-asc' | 'permissions-desc';
}

export async function getRoles(params: RolesListParams) {
  'use cache';
  cacheLife('minutes');
  cacheTag('roles-list');

  const { keyword, status, scope, deptId } = params;
  // 非法页码在入口归一：LIMIT / OFFSET / 返回元信息三处共用同一值
  const { page, pageSize } = normalizePagination(params.page, params.pageSize);
  // 数据范围：空范围即空集（无可见部门 → 不得返回任何角色）
  if (isScopeDenied(scope)) return { data: [], pagination: paginationMeta(page, pageSize, 0) };
  const whereClause = buildRoleConditions(keyword, status, scope, deptId);

  // 按权限数排序：需要 LEFT JOIN role_permissions 聚合后排序（分页必须在排序之后）
  if (params.sort === 'permissions-asc' || params.sort === 'permissions-desc') {
    const permissionCountExpr = count(schema.rolePermissions.permissionId);
    const rows = await db
      .select({ ...getTableColumns(schema.roles), permissionCount: permissionCountExpr })
      .from(schema.roles)
      .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
      .where(whereClause)
      .groupBy(schema.roles.id)
      .orderBy(
        params.sort === 'permissions-asc' ? asc(permissionCountExpr) : desc(permissionCountExpr),
        asc(schema.roles.sort),
        desc(schema.roles.createdAt),
      )
      .limit(pageSize)
      .offset(offsetFor(page, pageSize));
    const total = await countRows(schema.roles, whereClause);
    return {
      data: rows.map((r) => ({ ...toRoleDTO(r), permissionCount: Number(r.permissionCount) })),
      pagination: paginationMeta(page, pageSize, total),
    };
  }

  const result = await withPagination(
    page,
    pageSize,
    db.select().from(schema.roles).where(whereClause)
      .orderBy(asc(schema.roles.sort), desc(schema.roles.createdAt))
      .limit(pageSize).offset(offsetFor(page, pageSize)),
    countRows(schema.roles, whereClause),
    toRoleDTO,
  );
  // 列表权限数：角色分配页需要据此提示"0 权限角色无法登录"；与角色管理列共用同一聚合
  const permissionCounts = await getRolePermissionCounts(result.data.map((r) => r.id));
  return {
    ...result,
    data: result.data.map((r) => ({ ...r, permissionCount: permissionCounts[r.id] ?? 0 })),
  };
}

/**
 * 按 ID 获取单个角色详情（支持内部 ID 和 publicId）
 *
 * @param lookupId 角色 ID
 * @param scope    操作者数据范围。**必填**：不可省略——省略即无范围约束，
 *                 会静默返回任意部门的角色详情（此前 JSDoc 声称有该参数但签名
 *                 里并不存在，属 interface 撒谎，见 ADR-014）。
 * @returns 角色不存在或不在范围内 → null（调用方据此返回 404）
 */
export async function getRoleById(lookupId: string, scope: UserScope) {
  const rows = await db.select().from(schema.roles)
    .where(and(eq(schema.roles.id, lookupId), scopeFilter(scope, schema.roles.deptId)))
    .limit(1);
  const row = rows[0];
  return row ? toRoleDTO(row) : null;
}

/** 角色-权限绑定行 → 权限 DTO（含分配时间） */
function toAssignedPermission(rp: {
  permission: { id: string; code: string; name: string; type: string };
  createdAt: Date;
}) {
  return {
    id: rp.permission.id,
    code: rp.permission.code,
    name: rp.permission.name,
    type: rp.permission.type,
    assignedAt: rp.createdAt,
  };
}

/**
 * 获取角色绑定的权限列表
 *
 * 角色必须在操作者数据范围内——范围约束是查询条件之一，不能只靠调用方
 * 先校验角色部门后即信任（见 ADR-014）。
 *
 * @param roleId 角色 ID
 * @param scope  操作者数据范围（必填，理由同 {@link getRoleById}）
 * @returns 角色不存在或不在范围内 → 空数组
 */
export async function getRolePermissions(roleId: string, scope: UserScope) {
  // 使用 Relational Queries 一次性带出角色及其绑定的权限
  const role = await db.query.roles.findFirst({
    where: and(eq(schema.roles.id, roleId), scopeFilter(scope, schema.roles.deptId)),
    with: { rolePermissions: { with: { permission: true } } },
  });

  if (!role) return [];

  return role.rolePermissions.filter(rp => rp.permission !== null).map(toAssignedPermission);
}

/**
 * 批量统计角色当前绑定的用户数（删除确认的影响面，U-ROLES03）。
 *
 * 读路径无 "use cache"：删除确认需要**当前**数据，且只在列表页渲染时算一次
 * （单页角色数 ≤ pageSize，`IN (...)` + GROUP BY 一次查询）。
 *
 * @param roleIds 当前页角色 ID（空数组直接返回空对象，零查询）
 * @returns roleId → 绑定用户数
 */
export async function getRoleBoundUserCounts(
  roleIds: readonly string[],
): Promise<Record<string, number>> {
  if (roleIds.length === 0) return {};
  // 逻辑删除用户仍可能保留 user_roles 行；影响面只统计未删除用户，
  // 否则角色列表/删除确认会把已离职（软删）账号算进"绑定用户数"。
  const rows = await db
    .select({ roleId: schema.userRoles.roleId, boundUsers: count() })
    .from(schema.userRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .where(and(inArray(schema.userRoles.roleId, [...roleIds]), isNull(schema.users.deletedAt)))
    .groupBy(schema.userRoles.roleId);
  return Object.fromEntries(rows.map((r) => [r.roleId, Number(r.boundUsers)]));
}

/**
 * 角色权限数（当前页角色 → 绑定权限条数）。
 *
 * 用途：列表直接区分"空壳角色"（0 项，可能创建后没配权）与"高权角色"；
 * 计数走 role_permissions 聚合，只统计当前页角色，避免全表扫描。
 */
export async function getRolePermissionCounts(
  roleIds: readonly string[],
): Promise<Record<string, number>> {
  if (roleIds.length === 0) return {};
  const rows = await db
    .select({ roleId: schema.rolePermissions.roleId, amount: count() })
    .from(schema.rolePermissions)
    .where(inArray(schema.rolePermissions.roleId, [...roleIds]))
    .groupBy(schema.rolePermissions.roleId);
  return Object.fromEntries(rows.map((r) => [r.roleId, Number(r.amount)]));
}
