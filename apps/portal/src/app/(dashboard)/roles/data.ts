/**
 * 角色管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, ilike, or, asc, desc, and, sql as drizzleSql } from 'drizzle-orm';
import type { EntityStatus } from '@auth-sso/contracts';

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
    conditions.push(eq(schema.roles.status, status as EntityStatus));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // 使用 COUNT(*) 聚合查询，避免拉取全部 ID 到内存再统计
  const countResult = await db.select({ count: drizzleSql`COUNT(*)::int` })
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
      id: r.id, publicId: r.publicId, name: r.name, code: r.code,
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
    .where(or(eq(schema.roles.id, lookupId), eq(schema.roles.publicId, lookupId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    publicId: row.publicId,
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
  return db.select({
    id: schema.permissions.id,
    publicId: schema.permissions.publicId,
    code: schema.permissions.code,
    name: schema.permissions.name,
    type: schema.permissions.type,
    resource: schema.permissions.resource,
    action: schema.permissions.action,
    assignedAt: schema.rolePermissions.createdAt,
  })
    .from(schema.permissions)
    .innerJoin(schema.rolePermissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
    .innerJoin(schema.roles, eq(schema.rolePermissions.roleId, schema.roles.id))
    .where(or(eq(schema.roles.id, roleId), eq(schema.roles.publicId, roleId)));
}

/**
 * 获取角色绑定的 OAuth Client 列表
 */
export async function getRoleClients(roleId: string) {
  return db.select({
    id: schema.clients.id,
    publicId: schema.clients.publicId,
    name: schema.clients.name,
    clientId: schema.clients.clientId,
    redirectUrls: schema.clients.redirectUrls,
    scopes: schema.clients.scopes,
    homepageUrl: schema.clients.homepageUrl,
    logoUrl: schema.clients.icon,
    status: schema.clients.status,
    assignedAt: schema.roleClients.createdAt,
  })
    .from(schema.clients)
    .innerJoin(schema.roleClients, eq(schema.clients.id, schema.roleClients.clientId))
    .innerJoin(schema.roles, eq(schema.roleClients.roleId, schema.roles.id))
    .where(or(eq(schema.roles.id, roleId), eq(schema.roles.publicId, roleId)));
}

/**
 * 获取角色的数据范围绑定（含部门名称）
 */
export async function getRoleDataScopes(roleId: string) {
  return db.select({
    id: schema.roleDataScopes.id,
    roleId: schema.roleDataScopes.roleId,
    deptId: schema.roleDataScopes.deptId,
    deptName: schema.departments.name,
    createdAt: schema.roleDataScopes.createdAt,
  })
    .from(schema.roleDataScopes)
    .innerJoin(schema.departments, eq(schema.roleDataScopes.deptId, schema.departments.id))
    .where(eq(schema.roleDataScopes.roleId, roleId));
}
