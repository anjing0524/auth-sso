/**
 * 角色管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, ilike, or, asc, desc, and, count, inArray } from 'drizzle-orm';

import { ForbiddenError } from '@/domain/shared/errors';
import { asEntityStatus } from '@/lib/type-guards';
import { resolveIdentity, canAccessDept, logServerDataRead } from '@/lib/auth';

/**
 * 分页获取角色列表
 *
 * @param params.deptIds 可选的部门范围过滤（数据范围控制）；为空数组时返回空集
 */
export async function getRoles(params: {
  page: number;
  pageSize: number;
  keyword: string;
  status: string;
  deptIds?: string[];
}) {
  'use cache';
  cacheLife('minutes');
  cacheTag('roles-list');

  const { page, pageSize, keyword, status, deptIds } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  // 数据范围：仅返回管理员可见部门内的角色（H-ACL-002）
  if (deptIds && deptIds.length === 0) {
    return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
  }
  if (deptIds && deptIds.length > 0) {
    conditions.push(inArray(schema.roles.deptId, deptIds));
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

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // 使用 COUNT(*) 聚合查询，避免拉取全部 ID 到内存再统计
  const countResult = await db.select({ count: count() })
    .from(schema.roles).where(whereClause);
  const total = Number(countResult[0]?.count ?? 0);

  const rows = await db.select()
    .from(schema.roles)
    .where(whereClause)
    .orderBy(asc(schema.roles.sort), desc(schema.roles.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    data: rows.map(r => ({
      id: r.id, name: r.name, code: r.code,
      description: r.description, deptId: r.deptId,
      isSystem: r.isSystem ?? false, status: r.status, sort: r.sort ?? 0,
      createdAt: r.createdAt.toISOString(),
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * 按 ID 获取单个角色详情（支持内部 ID 和 publicId）
 */
export async function getRoleById(lookupId: string) {
  const identity = await resolveIdentity();
  if (!identity) throw new Error('Unauthorized');

  const rows = await db.select().from(schema.roles)
    .where(eq(schema.roles.id, lookupId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  if (!canAccessDept(identity.claims.deptIds, row.deptId)) {
    throw new ForbiddenError('超出数据权限范围');
  }

  await logServerDataRead('role', lookupId);

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    deptId: row.deptId,
    isSystem: row.isSystem ?? false,
    status: row.status,
    sort: row.sort ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 获取角色绑定的权限列表
 */
export async function getRolePermissions(roleId: string) {
  const identity = await resolveIdentity();
  if (!identity) throw new Error('Unauthorized');

  // 使用 Relational Queries 一次性带出角色及其绑定的权限
  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, roleId),
    with: {
      rolePermissions: {
        with: {
          permission: true,
        },
      },
    },
  });

  if (!role) return [];

  if (!canAccessDept(identity.claims.deptIds, role.deptId)) {
    throw new ForbiddenError('超出数据权限范围');
  }
  await logServerDataRead('role_permissions', roleId);

  return role.rolePermissions
    .filter(rp => rp.permission !== null)
    .map(rp => ({
      id: rp.permission.id,
      code: rp.permission.code,
      name: rp.permission.name,
      type: rp.permission.type,
      resource: rp.permission.resource,
      action: rp.permission.action,
      assignedAt: rp.createdAt,
    }));
}

