/**
 * Client 管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { ilike, eq, or, desc, and, count } from 'drizzle-orm';
import { ENTITY_STATUS_VALUES, type EntityStatus } from '@auth-sso/contracts';

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
  if (status && ENTITY_STATUS_VALUES.includes(status as EntityStatus)) {
    conditions.push(eq(schema.clients.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db.select({ count: count() })
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
      redirectUris: c.redirectUrls,
      scopes: c.scopes, homepageUrl: c.homepageUrl, logoUrl: c.icon,
      status: c.status, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt?.toISOString(),
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * 按 ID 获取单个 Client 详情（支持内部 ID 和 publicId）
 *
 * 不使用缓存，确保详情数据实时性。
 */
export async function getClientById(lookupId: string) {
  const rows = await db.select().from(schema.clients)
    .where(or(eq(schema.clients.id, lookupId), eq(schema.clients.publicId, lookupId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    publicId: row.publicId,
    name: row.name,
    clientId: row.clientId,
    redirectUris: row.redirectUrls,
    scopes: row.scopes,
    homepageUrl: row.homepageUrl,
    logoUrl: row.icon,
    accessTokenTtl: row.accessTokenTtl,
    refreshTokenTtl: row.refreshTokenTtl,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

/**
 * 获取 Client 的授权 Token 列表（分页 + 按用户过滤）
 */
export async function getClientTokens(
  clientId: string,
  params: { page: number; pageSize: number; userId?: string },
) {
  const { page, pageSize, userId } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(schema.accessTokens.clientId, clientId)];
  if (userId) conditions.push(eq(schema.accessTokens.userId, userId));

  const countResult = await db.select({ count: count() })
    .from(schema.accessTokens)
    .where(and(...conditions));
  const total = Number(countResult[0]?.count ?? 0);

  const tokens = await db.select({
    id: schema.accessTokens.id,
    userId: schema.accessTokens.userId,
    scopes: schema.accessTokens.scopes,
    createdAt: schema.accessTokens.createdAt,
    expiresAt: schema.accessTokens.expiresAt,
    userEmail: schema.users.email,
    userName: schema.users.name,
  })
    .from(schema.accessTokens)
    .leftJoin(schema.users, eq(schema.accessTokens.userId, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.accessTokens.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    data: tokens.map(t => ({
      id: t.id,
      userId: t.userId,
      username: t.userEmail || t.userName,
      scopes: JSON.parse(t.scopes || '[]'),
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
