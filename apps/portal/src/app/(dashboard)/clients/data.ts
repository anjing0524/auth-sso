/**
 * Client 管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { ilike, eq, or, desc, and, count, gt } from 'drizzle-orm';
import { ENTITY_STATUS_VALUES, type EntityStatus } from '@auth-sso/contracts';
import { asEntityStatus } from '@/lib/type-guards';
import { logServerDataRead } from '@/lib/auth';

/**
 * Client API 响应的 DTO 类型（日期已序列化为 ISO 8601 string）
 *
 * 与 domain Client 实体不同：DTO 使用 string 日期，
 * 供 Client Component 直接从 API 响应消费。
 */
export interface ClientDTO {
  clientId: string;
  name: string;
  redirectUris: string[];
  scopes: string;
  homepageUrl: string | null;
  logoUrl: string | null;
  accessTokenTtl: number | null;
  refreshTokenTtl: number | null;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string | null;
}

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
  if (status && ENTITY_STATUS_VALUES.includes(asEntityStatus(status))) {
    conditions.push(eq(schema.clients.status, asEntityStatus(status)));
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
      clientId: c.clientId, name: c.name,
      redirectUris: c.redirectUris,
      scopes: c.scopes, homepageUrl: c.homepageUrl, logoUrl: c.logoUrl,
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
export async function getClientById(lookupId: string): Promise<ClientDTO | null> {
  const rows = await db.select().from(schema.clients)
    .where(eq(schema.clients.clientId, lookupId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  await logServerDataRead('client', lookupId);

  return {
    clientId: row.clientId,
    name: row.name,
    redirectUris: row.redirectUris,
    scopes: row.scopes,
    homepageUrl: row.homepageUrl,
    logoUrl: row.logoUrl,
    accessTokenTtl: row.accessTokenTtl,
    refreshTokenTtl: row.refreshTokenTtl,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

/**
 * 按 OAuth client_id 查找 Client（供 OAuth 授权/令牌端点使用）
 *
 * 与 getClientById 不同：本函数按 client_id 字段查找，
 * 返回 Drizzle 原始行以便 domain 层做进一步校验（validateClientActive）。
 * 不使用缓存以保证授权流程的实时性。
 */
export async function getClientByClientId(clientId: string) {
  const rows = await db.select()
    .from(schema.clients)
    .where(eq(schema.clients.clientId, clientId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Client Token 的 DTO 类型
 */
export interface ClientTokenDTO {
  id: string;
  userId: string;
  username: string | undefined;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date | null;
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

  await logServerDataRead('client_tokens', clientId);

  const conditions = [
    eq(schema.accessTokens.clientId, clientId),
    // 仅返回未过期（活跃）token；过期行留存于表以备审计，但不进入列表与计数
    gt(schema.accessTokens.expiresAt, new Date()),
  ];
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
      // OAuth scope 按 RFC 6749 为空格分隔字符串（与 token 签发、introspection 语义一致）
      scopes: t.scopes ? t.scopes.split(/\s+/).filter(Boolean) : [],
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
