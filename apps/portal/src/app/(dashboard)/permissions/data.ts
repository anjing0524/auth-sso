/**
 * 权限管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, asc, and, or } from 'drizzle-orm';
import type { PermissionType } from '@auth-sso/contracts';

/**
 * 获取权限列表（可按类型过滤）
 */
export async function getPermissions(type?: string) {
  'use cache';
  cacheLife('hours');
  cacheTag('permissions-list');

  const conditions = [];
  if (type) {
    conditions.push(eq(schema.permissions.type, type as PermissionType));
  }

  const rows = await db.select()
    .from(schema.permissions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt));

  return rows.map(p => ({
    id: p.id, publicId: p.publicId, name: p.name, code: p.code,
    type: p.type, resource: p.resource, action: p.action,
    parentId: p.parentId, status: p.status, sort: p.sort,
    createdAt: p.createdAt.toISOString(),
  }));
}

/**
 * 按 ID 获取单个权限详情（支持内部 ID 和 publicId）
 */
export async function getPermissionById(lookupId: string) {
  const rows = await db.select().from(schema.permissions)
    .where(or(eq(schema.permissions.id, lookupId), eq(schema.permissions.publicId, lookupId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, publicId: row.publicId, name: row.name, code: row.code,
    type: row.type, resource: row.resource, action: row.action,
    parentId: row.parentId, status: row.status, sort: row.sort,
    createdAt: row.createdAt.toISOString(),
  };
}
