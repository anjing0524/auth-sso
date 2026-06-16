/**
 * 角色管理读模型 (Read Model)
 */
import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, ilike, or, asc, desc, and } from 'drizzle-orm';
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

  const allRows = await db.select({ id: schema.roles.id }).from(schema.roles).where(whereClause);
  const total = allRows.length;

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
