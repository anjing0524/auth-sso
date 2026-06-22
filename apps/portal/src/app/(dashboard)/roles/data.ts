/**
 * 角色管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, ilike, or, asc, desc, and, count } from 'drizzle-orm';
import { asEntityStatus } from '@/lib/type-guards';

/**
 * 分页获取角色列表
 */
export async function getRoles(params: {
  page: number;
  pageSize: number;
  keyword: string;
  status: string;
}) {
  'use cache';
  cacheLife('minutes');
  cacheTag('roles-list');

  const { page, pageSize, keyword, status } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [];
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
      description: r.description, dataScopeType: r.dataScopeType,
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
  const rows = await db.select().from(schema.roles)
    .where(eq(schema.roles.id, lookupId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    dataScopeType: row.dataScopeType,
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

/**
 * 获取角色绑定的 OAuth Client 列表
 */
export async function getRoleClients(roleId: string) {
  // 使用 Relational Queries 一次性带出角色及其绑定的 Client
  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, roleId),
    with: {
      roleClients: {
        with: {
          client: true,
        },
      },
    },
  });

  if (!role) return [];

  return role.roleClients
    .filter(rc => rc.client !== null)
    .map(rc => ({
      clientId: rc.client.clientId,
      name: rc.client.name,
      redirectUris: rc.client.redirectUris,
      scopes: rc.client.scopes,
      homepageUrl: rc.client.homepageUrl,
      logoUrl: rc.client.logoUrl,
      status: rc.client.status,
      assignedAt: rc.createdAt,
    }));
}

/**
 * 获取角色的数据范围绑定（含部门名称）
 */
export async function getRoleDataScopes(roleId: string) {
  // 使用 Relational Queries 一次性带出角色绑定的数据范围及关联的部门
  const rds = await db.query.roleDataScopes.findMany({
    where: eq(schema.roleDataScopes.roleId, roleId),
    with: {
      department: true,
    },
  });

  return rds.map(item => ({
    roleId: item.roleId,
    deptId: item.deptId,
    deptName: item.department?.name || null,
    createdAt: item.createdAt,
  }));
}

