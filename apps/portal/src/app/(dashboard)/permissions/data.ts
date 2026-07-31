/**
 * 权限管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, asc, count, isNotNull } from 'drizzle-orm';
import { asPermissionType } from '@/lib/type-guards';
import { logServerDataRead } from '@/lib/auth';

/**
 * 获取权限列表（可按类型过滤）
 */
type PermissionListItem = {
  id: string;
  name: string;
  code: string;
  type: string;
  description: string | null;
  path: string | null;
  icon: string | null;
  visible: boolean | null;
  clientId: string | null;
  parentId: string | null;
  requiredPermissionId: string | null;
  status: string;
  sort: number;
  boundRoleCount: number;
  boundMenuCount: number;
  createdAt: string;
};

function toPermissionListItem(
  p: typeof schema.permissions.$inferSelect,
  boundRoleCount = 0,
  boundMenuCount = 0,
): PermissionListItem {
  return {
    id: p.id, name: p.name, code: p.code, description: p.description,
    type: p.type, path: p.path, icon: p.icon, visible: p.visible,
    clientId: p.clientId,
    parentId: p.parentId, requiredPermissionId: p.requiredPermissionId,
    status: p.status, sort: p.sort,
    boundRoleCount,
    boundMenuCount,
    createdAt: p.createdAt.toISOString(),
  };
}

function buildPermissionConditions(type?: string) {
  return type ? eq(schema.permissions.type, asPermissionType(type)) : undefined;
}

export async function getPermissions(type?: string): Promise<PermissionListItem[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('permissions-list');

  const [rows, roleBindings, menuBindings] = await Promise.all([
    db.select()
      .from(schema.permissions)
      .where(buildPermissionConditions(type))
      .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt)),
    db.select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions),
    db.select({ permissionId: schema.permissions.requiredPermissionId })
      .from(schema.permissions)
      .where(isNotNull(schema.permissions.requiredPermissionId)),
  ]);
  const roleCounts = new Map<string, number>();
  const menuCounts = new Map<string, number>();
  for (const binding of roleBindings) {
    roleCounts.set(binding.permissionId, (roleCounts.get(binding.permissionId) ?? 0) + 1);
  }
  for (const binding of menuBindings) {
    if (binding.permissionId) {
      menuCounts.set(binding.permissionId, (menuCounts.get(binding.permissionId) ?? 0) + 1);
    }
  }

  return rows.map((row) => toPermissionListItem(
    row,
    roleCounts.get(row.id) ?? 0,
    menuCounts.get(row.id) ?? 0,
  ));
}

export async function getPermissionPage({ type, page, pageSize }: {
  type?: string;
  page: number;
  pageSize: number;
}): Promise<{ data: PermissionListItem[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
  'use cache';
  cacheLife('hours');
  cacheTag('permissions-list');

  const conditions = buildPermissionConditions(type);
  const [totalRow] = await db.select({ total: count() }).from(schema.permissions).where(conditions);
  const total = totalRow?.total ?? 0;
  const rows = await db.select().from(schema.permissions)
    .where(conditions)
    .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    data: rows.map((row) => toPermissionListItem(row)),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * 按 ID 获取单个权限详情（内部 UUID）
 */
export async function getPermissionById(lookupId: string) {
  const rows = await db.select().from(schema.permissions)
    .where(eq(schema.permissions.id, lookupId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  await logServerDataRead('permission', lookupId);

  return {
    id: row.id, name: row.name, code: row.code, description: row.description,
    type: row.type, path: row.path, icon: row.icon, visible: row.visible,
    clientId: row.clientId,
    parentId: row.parentId, requiredPermissionId: row.requiredPermissionId,
    status: row.status, sort: row.sort,
    createdAt: row.createdAt.toISOString(),
  };
}
