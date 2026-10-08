/**
 * 角色管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, ilike, or, asc, desc, and, inArray, sql } from 'drizzle-orm';

import { asEntityStatus } from '@/lib/type-guards';
import type { EntityStatus } from '@auth-sso/contracts';
import { paginationMeta, withPagination, countRows } from '@/lib/pagination';

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
function buildRoleConditions(keyword: string, status: string, deptIds: string[]) {
  const conditions = [];
  // 数据范围过滤（v3.2: 直接按部门 ID 列表过滤）
  // 空 deptIds → fail-closed：添加 SQL 恒假条件防止无意中返回全表数据
  if (deptIds.length > 0) {
    conditions.push(inArray(schema.roles.deptId, deptIds));
  } else {
    conditions.push(sql`FALSE`);
  }
  if (keyword) {
    conditions.push(or(
      ilike(schema.roles.name, `%${keyword}%`),
      ilike(schema.roles.code, `%${keyword}%`),
    ));
  }
  if (status) {
    conditions.push(eq(schema.roles.status, asEntityStatus(status)));
  }
  // 使用 COUNT(*) 聚合查询，避免拉取全部 ID 到内存再统计
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * 分页获取角色列表
 *
 * @param params.deptIds 操作者可访问的部门 ID 列表（必填，数据范围控制）
 */
export interface RolesListParams {
  page: number;
  pageSize: number;
  keyword: string;
  status: string;
  /**
   * 操作者可访问的部门 ID 列表（必填）。
   *
   * 刻意不设为可选：可选参数会让"忘记传范围"编译通过并静默返回全部角色，
   * 而省略与传空数组在语义上完全不同（后者是"无权限"，前者是"不过滤"）。
   */
  deptIds: string[];
}

export async function getRoles(params: RolesListParams) {
  'use cache';
  cacheLife('minutes');
  cacheTag('roles-list');

  const { page, pageSize, keyword, status, deptIds } = params;
  // 数据范围：空范围即空集（无可见部门 → 不得返回任何角色）
  if (deptIds.length === 0) return { data: [], pagination: paginationMeta(page, pageSize, 0) };
  const whereClause = buildRoleConditions(keyword, status, deptIds);

  return withPagination(
    page,
    pageSize,
    db.select().from(schema.roles).where(whereClause)
      .orderBy(asc(schema.roles.sort), desc(schema.roles.createdAt))
      .limit(pageSize).offset((page - 1) * pageSize),
    countRows(schema.roles, whereClause),
    toRoleDTO,
  );
}

/**
 * 按 ID 获取单个角色详情（支持内部 ID 和 publicId）
 *
 * @param lookupId 角色 ID
 * @param deptIds  操作者数据范围（可选：API Route 传入；Server Component 自查询不传）
 */
export async function getRoleById(lookupId: string) {
  const rows = await db.select().from(schema.roles)
    .where(eq(schema.roles.id, lookupId))
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
 * @param roleId  角色 ID
 * @param deptIds 操作者数据范围（可选：API Route 传入；Server Component 自查询不传）
 */
export async function getRolePermissions(roleId: string) {
  // 使用 Relational Queries 一次性带出角色及其绑定的权限
  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, roleId),
    with: { rolePermissions: { with: { permission: true } } },
  });

  if (!role) return [];

  return role.rolePermissions.filter(rp => rp.permission !== null).map(toAssignedPermission);
}

