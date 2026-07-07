/**
 * 权限管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, asc, and } from 'drizzle-orm';
import { asPermissionType } from '@/lib/type-guards';
import { logServerDataRead } from '@/lib/auth';

/**
 * 获取权限列表（可按类型过滤）
 */
export async function getPermissions(type?: string) {
  'use cache';
  cacheLife('hours');
  cacheTag('permissions-list');

  const conditions = [];
  if (type) {
    conditions.push(eq(schema.permissions.type, asPermissionType(type)));
  }

  const rows = await db.select()
    .from(schema.permissions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt));

  return rows.map(p => ({
    id: p.id, name: p.name, code: p.code,
    type: p.type, path: p.path, icon: p.icon, visible: p.visible,
    resource: p.resource, action: p.action, clientId: p.clientId,
    parentId: p.parentId, status: p.status, sort: p.sort,
    createdAt: p.createdAt.toISOString(),
  }));
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
    id: row.id, name: row.name, code: row.code,
    type: row.type, path: row.path, icon: row.icon, visible: row.visible,
    resource: row.resource, action: row.action, clientId: row.clientId,
    parentId: row.parentId, status: row.status, sort: row.sort,
    createdAt: row.createdAt.toISOString(),
  };
}
