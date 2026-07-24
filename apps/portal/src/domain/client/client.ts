import type { CreateClientInput, Client } from './types';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import { dateFromInstant, instantFromDate } from '@/domain/shared/time';

export type { Client };

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

export function clientToInsertRow(c: Client) {
  return {
    clientId: c.clientId,
    name: c.name,
    redirectUris: c.redirectUris,
    scopes: c.scopes,
    homepageUrl: c.homepageUrl,
    logoUrl: c.logoUrl,
    accessTokenTtl: c.accessTokenTtl,
    refreshTokenTtl: c.refreshTokenTtl,
    status: c.status,
    createdAt: dateFromInstant(c.createdAt),
  };
}

export function clientFromPersistence(client: Omit<Client, 'createdAt'> & { createdAt: Date }): Client {
  return { ...client, createdAt: instantFromDate(client.createdAt) };
}

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
