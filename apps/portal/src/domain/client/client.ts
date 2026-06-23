import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import type { CreateClientInput, Client } from './types';

export type { Client };

/**
 * 将 Drizzle 数据库行转换为领域 Client 实体
 */
export function toDomainClient(row: {
  clientId: string;
  name: string;
  clientSecret: string | null;
  redirectUris: string[];
  scopes: string;
  homepageUrl: string | null;
  logoUrl: string | null;
  accessTokenTtl: number | null;
  refreshTokenTtl: number | null;
  status: import('@auth-sso/contracts').EntityStatus;
  createdAt: Date;
}): Client {
  return {
    clientId: row.clientId,
    name: row.name,
    clientSecret: row.clientSecret,
    redirectUris: row.redirectUris,
    scopes: row.scopes,
    homepageUrl: row.homepageUrl,
    logoUrl: row.logoUrl,
    accessTokenTtl: row.accessTokenTtl ?? 3600,
    refreshTokenTtl: row.refreshTokenTtl ?? 604800,
    status: row.status,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 工厂函数：构建新 Client 实体 (无副作用)
 */
export function createClient(
  input: CreateClientInput,
  clientIdGenerator: () => string,
  secretGenerator: () => string,
): Client {
  return {
    clientId: clientIdGenerator(),
    name: input.name,
    clientSecret: secretGenerator(),
    redirectUris: input.redirectUris,
    scopes: input.scopes,
    homepageUrl: input.homepageUrl ?? null,
    logoUrl: input.logoUrl ?? null,
    accessTokenTtl: input.accessTokenTtl,
    refreshTokenTtl: input.refreshTokenTtl,
    status: ENTITY_ACTIVE,
    createdAt: Temporal.Now.instant(),
  };
}

/**
 * 纯函数：构建更新后的 Client 对象 (无副作用)
 */
export function applyClientUpdate(
  client: Client,
  patch: Partial<Pick<Client, 'name' | 'redirectUris' | 'scopes' | 'homepageUrl' | 'logoUrl' | 'accessTokenTtl' | 'refreshTokenTtl' | 'status'>>,
): Client {
  return {
    ...client,
    name: patch.name ?? client.name,
    redirectUris: patch.redirectUris ?? client.redirectUris,
    scopes: patch.scopes ?? client.scopes,
    homepageUrl: patch.homepageUrl !== undefined ? patch.homepageUrl : client.homepageUrl,
    logoUrl: patch.logoUrl !== undefined ? patch.logoUrl : client.logoUrl,
    accessTokenTtl: patch.accessTokenTtl ?? client.accessTokenTtl,
    refreshTokenTtl: patch.refreshTokenTtl ?? client.refreshTokenTtl,
    status: patch.status ?? client.status,
  };
}

// ────────────────────────────────────────────
// DB 行转换（统一 Controller 层的列映射，消除重复）
// ────────────────────────────────────────────

/** 将领域实体转为 Drizzle insert 行 */
export function clientToInsertRow(c: Client) {
  return {
    clientId: c.clientId,
    name: c.name,
    clientSecret: c.clientSecret,
    redirectUris: c.redirectUris,
    scopes: c.scopes,
    homepageUrl: c.homepageUrl,
    logoUrl: c.logoUrl,
    accessTokenTtl: c.accessTokenTtl,
    refreshTokenTtl: c.refreshTokenTtl,
    status: c.status,
    createdAt: new Date(c.createdAt.epochMilliseconds),
  };
}

/** 将领域实体转为 Drizzle update 行 */
export function clientToUpdateRow(c: Client) {
  return {
    name: c.name,
    redirectUris: c.redirectUris,
    scopes: c.scopes,
    homepageUrl: c.homepageUrl,
    logoUrl: c.logoUrl,
    accessTokenTtl: c.accessTokenTtl,
    refreshTokenTtl: c.refreshTokenTtl,
    status: c.status,
  };
}
