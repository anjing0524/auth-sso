/**
 * Client 管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { ilike, eq, or, desc, and, count, gt, isNull } from 'drizzle-orm';
import { ENTITY_STATUS_VALUES, type EntityStatus } from '@auth-sso/contracts';
import { asEntityStatus } from '@/lib/type-guards';


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
 * 获取 Client 的活跃会话凭证列表（分页 + 按用户过滤）
 *
 * 数据源为 refresh_tokens（RT 绑定发放 client）：AT 无 client 语义且无持久化行，
 * "Client 的 Token" 的真实含义是该 client 的授权家族 —— 即其名下的 RT。
 */
export async function getClientTokens(
  clientId: string,
  params: { page: number; pageSize: number; userId?: string },
) {
  const { page, pageSize, userId } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(schema.refreshTokens.clientId, clientId),
    // 仅返回活跃会话：未撤销且未过期
    isNull(schema.refreshTokens.revoked),
    gt(schema.refreshTokens.expiresAt, new Date()),
  ];
  if (userId) conditions.push(eq(schema.refreshTokens.userId, userId));

  const countResult = await db.select({ count: count() })
    .from(schema.refreshTokens)
    .where(and(...conditions));
  const total = Number(countResult[0]?.count ?? 0);

  const tokens = await db.select({
    id: schema.refreshTokens.id,
    userId: schema.refreshTokens.userId,
    scopes: schema.refreshTokens.scopes,
    createdAt: schema.refreshTokens.createdAt,
    expiresAt: schema.refreshTokens.expiresAt,
    userEmail: schema.users.email,
    userName: schema.users.name,
  })
    .from(schema.refreshTokens)
    .leftJoin(schema.users, eq(schema.refreshTokens.userId, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.refreshTokens.createdAt))
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
