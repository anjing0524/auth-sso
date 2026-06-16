/**
 * Client 管理读模型 (Read Model)
 */
import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { ilike, eq, or, desc, and, sql as drizzleSql } from 'drizzle-orm';
import { parseRedirectUris } from '@/domain/client/client';

/**
 * 分页获取 Client 列表
 */
export async function getClients(params: {
  page: number;
  pageSize: number;
  keyword: string;
  status: string;
}) {
  'use cache';
  cacheLife('minutes');
  cacheTag('clients-list');

  const { page, pageSize, keyword, status } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (keyword) {
    conditions.push(or(
      ilike(schema.clients.name, `%${keyword}%`),
      ilike(schema.clients.clientId, `%${keyword}%`),
    ));
  }
  if (status && (status === 'ACTIVE' || status === 'DISABLED')) {
    conditions.push(eq(schema.clients.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db.select({ count: drizzleSql`COUNT(*)::int` })
    .from(schema.clients).where(whereClause);
  const total = Number(countResult[0]?.count ?? 0);

  const rows = await db.select()
    .from(schema.clients)
    .where(whereClause)
    .orderBy(desc(schema.clients.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    data: rows.map(c => ({
      id: c.id, publicId: c.publicId, name: c.name, clientId: c.clientId,
      redirectUris: parseRedirectUris(c.redirectUrls),
      scopes: c.scopes, homepageUrl: c.homepageUrl, logoUrl: c.icon,
      status: c.status, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt?.toISOString(),
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
