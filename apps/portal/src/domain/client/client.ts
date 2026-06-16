import type { EntityStatus } from '@auth-sso/contracts';
import type { CreateClientInput, Client } from './types';

export type { Client };

/**
 * 纯函数：解析 redirectUrls 字符串为数组
 */
export function parseRedirectUris(raw: string): string[] {
  try {
    if (raw.startsWith('[')) {
      return JSON.parse(raw) as string[];
    }
    return raw.split(',').map(u => u.trim());
  } catch {
    return [raw];
  }
}

/**
 * 将 Drizzle 数据库行转换为领域 Client 实体
 */
export function toDomainClient(row: {
  id: string;
  publicId: string;
  name: string;
  clientId: string;
  clientSecret: string | null;
  redirectUrls: string;
  grantTypes: string;
  scopes: string;
  homepageUrl: string | null;
  icon: string | null;
  accessTokenTtl: number | null;
  refreshTokenTtl: number | null;
  status: string;
  disabled: boolean | null;
  skipConsent: boolean | null;
  userId: string | null;
  createdAt: Date;
}): Client {
  return {
    id: row.id,
    publicId: row.publicId,
    name: row.name,
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    redirectUris: parseRedirectUris(row.redirectUrls),
    grantTypes: row.grantTypes,
    scopes: row.scopes,
    homepageUrl: row.homepageUrl,
    logoUrl: row.icon,
    accessTokenTtl: row.accessTokenTtl ?? 3600,
    refreshTokenTtl: row.refreshTokenTtl ?? 604800,
    status: row.status as EntityStatus,
    disabled: row.disabled ?? false,
    skipConsent: row.skipConsent ?? false,
    userId: row.userId,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 工厂函数：构建新 Client 实体 (无副作用)
 */
export function createClient(
  input: CreateClientInput,
  idGenerator: (len: number) => string,
  clientIdGenerator: () => string,
  secretGenerator: () => string,
): Client {
  return {
    id: idGenerator(20),
    publicId: `cli_${idGenerator(8)}`,
    name: input.name,
    clientId: clientIdGenerator(),
    clientSecret: secretGenerator(),
    redirectUris: input.redirectUris,
    grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
    scopes: input.scopes,
    homepageUrl: input.homepageUrl ?? null,
    logoUrl: input.logoUrl ?? null,
    accessTokenTtl: input.accessTokenTtl,
    refreshTokenTtl: input.refreshTokenTtl,
    status: 'ACTIVE',
    disabled: false,
    skipConsent: input.skipConsent,
    userId: null,
    createdAt: Temporal.Now.instant(),
  };
}

/**
 * 纯函数：构建更新后的 Client 对象 (无副作用)
 */
export function applyClientUpdate(
  client: Client,
  patch: Partial<Pick<Client, 'name' | 'redirectUris' | 'scopes' | 'homepageUrl' | 'logoUrl' | 'accessTokenTtl' | 'refreshTokenTtl' | 'skipConsent' | 'status' | 'disabled'>>,
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
    skipConsent: patch.skipConsent ?? client.skipConsent,
    status: patch.status ?? client.status,
    disabled: patch.disabled ?? client.disabled,
  };
}

// ────────────────────────────────────────────
// DB 行转换（统一 Controller 层的列映射，消除重复）
// ────────────────────────────────────────────

/** 将领域实体转为 Drizzle insert 行（仅用于创建路径） */
export function clientToInsertRow(c: Client) {
  return {
    id: c.id,
    publicId: c.publicId,
    name: c.name,
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    redirectUrls: JSON.stringify(c.redirectUris),
    grantTypes: c.grantTypes,
    scopes: c.scopes,
    homepageUrl: c.homepageUrl,
    icon: c.logoUrl,
    accessTokenTtl: c.accessTokenTtl,
    refreshTokenTtl: c.refreshTokenTtl,
    status: c.status,
    disabled: c.disabled,
    skipConsent: c.skipConsent,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** 将领域实体转为 Drizzle update 行（仅用于更新路径） */
export function clientToUpdateRow(c: Client) {
  return {
    name: c.name,
    redirectUrls: JSON.stringify(c.redirectUris),
    scopes: c.scopes,
    homepageUrl: c.homepageUrl,
    icon: c.logoUrl,
    accessTokenTtl: c.accessTokenTtl,
    refreshTokenTtl: c.refreshTokenTtl,
    status: c.status,
    disabled: c.disabled,
    skipConsent: c.skipConsent,
    updatedAt: new Date(),
  };
}
