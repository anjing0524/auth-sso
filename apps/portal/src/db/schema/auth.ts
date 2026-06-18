/**
 * OIDC Provider 领域表 (OIDC Auth Domain Tables)
 *
 * - clients：OAuth 2.1 客户端应用
 * - authorizationCodes：授权码
 * - accessTokens / refreshTokens：令牌存储（用于 introspection / rotation / revocation）
 * - consents：用户授权同意记录
 * - jwks：签名密钥对
 *
 * 注意：scopes 列保持 text 类型 —— OAuth scope 在 RFC 6749 / JWT scope claim 中
 * 本就是空格分隔字符串，是正确的语义而非反模式。若未来需要按 scope 查询 client，
 * 可添加 GENERATED ALWAYS AS (string_to_array(scopes, ' ')) STORED 的 text[] 列 +
 * GIN 索引来支持高效查询，无需修改现有数据模型。
 *
 * @module db/schema/auth
 */
import { pgTable, text, timestamp, boolean, integer, index } from 'drizzle-orm/pg-core';
import { entityStatusEnum, jwkAlgorithmEnum, codeChallengeMethodEnum } from './enums';
import { users } from './users';
import { updatedAtColumn } from './helpers';

/**
 * OAuth 2.1 客户端应用
 *
 * redirectUris 使用 PG 原生 text[] 数组类型，无需应用层 JSON.parse/split。
 */
export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  name: text('name').notNull(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  redirectUris: text('redirect_uris').array().notNull(),
  scopes: text('scopes').notNull().default('openid profile email offline_access'),
  homepageUrl: text('homepage_url'),
  logoUrl: text('logo_url'),
  accessTokenTtl: integer('access_token_ttl').default(3600),
  refreshTokenTtl: integer('refresh_token_ttl').default(604800),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: updatedAtColumn(),
});

/**
 * OAuth 2.1 授权码
 */
export const authorizationCodes = pgTable('authorization_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull(),
  state: text('state'),
  nonce: text('nonce'),
  codeChallenge: text('code_challenge'),
  codeChallengeMethod: codeChallengeMethodEnum('code_challenge_method').default('S256'),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Access Token (用于 introspection + revocation)
 */
export const accessTokens = pgTable('access_tokens', {
  id: text('id').primaryKey(),
  token: text('token').unique(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_access_tokens_client').on(t.clientId),
  index('idx_access_tokens_user').on(t.userId),
]);

/**
 * Refresh Token (用于 rotation + revocation)
 */
export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  token: text('token').unique(),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  revoked: timestamp('revoked'),
  authTime: timestamp('auth_time'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: updatedAtColumn(),
  expiresAt: timestamp('expires_at'),
}, (t) => [
  index('idx_refresh_tokens_client').on(t.clientId),
  index('idx_refresh_tokens_user').on(t.userId),
]);

/**
 * OAuth Consent 授权记录
 */
export const consents = pgTable('consents', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  consentGiven: boolean('consent_given'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_consents_user_client').on(t.userId, t.clientId),
]);

/**
 * JWKS 密钥对
 */
export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  kid: text('kid').unique(),
  algorithm: jwkAlgorithmEnum('algorithm').default('ES256'),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});
