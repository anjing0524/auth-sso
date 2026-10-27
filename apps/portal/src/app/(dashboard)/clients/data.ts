/**
 * Client 管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { ilike, eq, or, desc, asc, and, gt, isNull, inArray, max, count } from 'drizzle-orm';
import { ENTITY_STATUS_VALUES, type EntityStatus } from '@auth-sso/contracts';
import { asEntityStatus } from '@/lib/type-guards';
import { withPagination, countRows, offsetFor, normalizePagination } from '@/lib/pagination';


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
  /** 最近一次签发 token 的时间（判断应用是否仍在使用；null=从未使用） */
  lastUsedAt?: string | null;
}

/** Client 行 → DTO（日期序列化）；列表与详情共用 */
function toClientDTO(c: {
  clientId: string; name: string; redirectUris: string[]; scopes: string;
  homepageUrl: string | null; logoUrl: string | null;
  accessTokenTtl: number | null; refreshTokenTtl: number | null;
  status: EntityStatus; createdAt: Date; updatedAt: Date | null;
}): ClientDTO {
  return {
    clientId: c.clientId, name: c.name,
    redirectUris: c.redirectUris,
    scopes: c.scopes, homepageUrl: c.homepageUrl, logoUrl: c.logoUrl,
    accessTokenTtl: c.accessTokenTtl, refreshTokenTtl: c.refreshTokenTtl,
    status: c.status, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt?.toISOString() ?? null,
  };
}

/** Client 列表过滤条件：关键字（名称/clientId）+ 状态 */
function buildClientConditions(keyword: string, status: string) {
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
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * 分页获取 Client 列表
 */
export interface ClientListParams {
  page: number;
  pageSize: number;
  keyword: string;
  status: string;
  /** 排序：recent（最近创建，默认）| updated（最近更新）| name（名称） */
  sort?: string;
}

export async function getClients(params: ClientListParams) {
  'use cache';
  cacheLife('minutes');
  cacheTag('clients-list');

  const { keyword, status } = params;
  const { page, pageSize } = normalizePagination(params.page, params.pageSize);
  const whereClause = buildClientConditions(keyword, status);
  const orderBy = params.sort === 'name'
    ? [asc(schema.clients.name)]
    : params.sort === 'updated'
      ? [desc(schema.clients.updatedAt)]
      : [desc(schema.clients.createdAt)];

  const result = await withPagination(
    page,
    pageSize,
    db.select().from(schema.clients).where(whereClause)
      .orderBy(...orderBy)
      .limit(pageSize).offset(offsetFor(page, pageSize)),
    countRows(schema.clients, whereClause),
    toClientDTO,
  );
  // 最近使用：按当前页 clientId 聚合 refresh_tokens 的最后签发时间（避免全表）
  const ids = result.data.map((c) => c.clientId);
  const usage = ids.length === 0 ? [] : await db
    .select({ clientId: schema.refreshTokens.clientId, lastUsedAt: max(schema.refreshTokens.createdAt) })
    .from(schema.refreshTokens)
    .where(inArray(schema.refreshTokens.clientId, ids))
    .groupBy(schema.refreshTokens.clientId);
  const lastUsed = new Map(usage.map((u) => [u.clientId, u.lastUsedAt?.toISOString() ?? null]));
  return {
    ...result,
    data: result.data.map((c) => ({ ...c, lastUsedAt: lastUsed.get(c.clientId) ?? null })),
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
  return row ? toClientDTO(row) : null;
}

/**
 * Client Token 的 DTO 类型
 */
export interface ClientTokenDTO {
  id: string;
  userId: string;
  /** 关联用户的展示名（email 优先）；left join 可能双空 → null */
  username: string | null;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date | null;
}

/** RT + 用户联查行 → ClientTokenDTO（scopes 空格串按 RFC 6749 拆分） */
function toClientTokenDTO(t: {
  id: string; userId: string; userEmail: string | null; userName: string | null;
  scopes: string | null; createdAt: Date; expiresAt: Date | null;
}): ClientTokenDTO {
  return {
    id: t.id,
    userId: t.userId,
    username: t.userEmail || t.userName,
    scopes: t.scopes ? t.scopes.split(/\s+/).filter(Boolean) : [],
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
  };
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
  const { userId } = params;
  const { page, pageSize } = normalizePagination(params.page, params.pageSize);

  const conditions = [
    eq(schema.refreshTokens.clientId, clientId),
    // 仅返回活跃会话：未撤销且未过期
    isNull(schema.refreshTokens.revoked),
    gt(schema.refreshTokens.expiresAt, new Date()),
  ];
  if (userId) conditions.push(eq(schema.refreshTokens.userId, userId));
  const whereClause = and(...conditions);

  const tokenRows = db.select({
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
    .where(whereClause)
    .orderBy(desc(schema.refreshTokens.createdAt))
    .limit(pageSize).offset(offsetFor(page, pageSize));

  return withPagination(
    page,
    pageSize,
    tokenRows,
    countRows(schema.refreshTokens, whereClause),
    toClientTokenDTO,
  );
}


/** 应用状态全局计数（与列表分页解耦；用于列表标题处的状态概览） */
export async function getClientStatusCounts(): Promise<{ active: number; disabled: number }> {
  'use cache';
  cacheLife('minutes');
  cacheTag('clients-list');

  const rows = await db
    .select({ status: schema.clients.status, count: count() })
    .from(schema.clients)
    .groupBy(schema.clients.status);
  const active = Number(rows.find((r) => r.status === 'ACTIVE')?.count ?? 0);
  const disabled = Number(rows.find((r) => r.status === 'DISABLED')?.count ?? 0);
  return { active, disabled };
}
