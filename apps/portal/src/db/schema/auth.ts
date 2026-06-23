/**
 * OIDC Provider 领域表 (OIDC Auth Domain Tables)
 *
 * - clients：OAuth 2.1 客户端应用（client_id 为 PK，统一 FK 引用目标）
 * - authorizationCodes：授权码
 * - accessTokens / refreshTokens：令牌存储（token_hash 替代明文 token）
 *
 * 注意：scopes 列保持 varchar 类型 —— OAuth scope 在 RFC 6749 / JWT scope claim 中
 * 本就是空格分隔字符串，是正确的语义而非反模式。
 *
 * v2 变更：
 * - clients: client_id 为 PK（消除 id + public_id + client_id 三标识符冗余）
 * - 所有 FK 统一引用 clients.client_id
 * - access/refresh tokens: token → token_hash varchar(64)
 * - uuid PK 替代 text PK
 * - timestamptz 替代 timestamp
 * - 移除 consents 表（无业务支撑）
 * - 移除 public_id
 *
 * @module db/schema/auth
 */
import { pgTable, uuid, varchar, text, timestamp, boolean, integer, index } from 'drizzle-orm/pg-core';
import { entityStatusEnum, codeChallengeMethodEnum } from './enums';
import { users } from './users';
import { createdAtColumn, updatedAtColumn } from './helpers';

/**
 * OAuth 2.1 客户端应用
 *
 * client_id 为 PK（OAuth 业务标识），同时是其他表 FK 的统一引用目标。
 * redirectUris 使用 PG 原生 text[] 数组类型。
 */
export const clients = pgTable('clients', {
  clientId: varchar('client_id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  clientSecret: varchar('client_secret', { length: 128 }),
  redirectUris: varchar('redirect_uris', { length: 255 }).array().notNull(),
  scopes: varchar('scopes', { length: 200 }).notNull().default('openid profile email offline_access'),
  homepageUrl: varchar('homepage_url', { length: 500 }),
  logoUrl: varchar('logo_url', { length: 500 }),
  accessTokenTtl: integer('access_token_ttl').default(3600),
  refreshTokenTtl: integer('refresh_token_ttl').default(604800),
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/**
 * OAuth 2.1 授权码
 */
export const authorizationCodes = pgTable('authorization_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 100 }).notNull().unique(),
  clientId: varchar('client_id', { length: 50 }).notNull().references(() => clients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: varchar('redirect_uri', { length: 500 }).notNull(),
  scope: varchar('scope', { length: 200 }).notNull(),
  state: varchar('state', { length: 100 }),
  nonce: varchar('nonce', { length: 100 }),
  codeChallenge: varchar('code_challenge', { length: 100 }),
  codeChallengeMethod: codeChallengeMethodEnum('code_challenge_method').default('S256'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  used: boolean('used').default(false),
  createdAt: createdAtColumn(),
});

/**
 * Access Token (用于 introspection + revocation)
 *
 * token_hash 存储 SHA256(token)，不可为空。
 */
export const accessTokens = pgTable('access_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  clientId: varchar('client_id', { length: 50 }).notNull().references(() => clients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopes: varchar('scopes', { length: 200 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_access_tokens_client').on(t.clientId),
  index('idx_access_tokens_user').on(t.userId),
]);

/**
 * Refresh Token (用于 rotation + revocation)
 */
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  clientId: varchar('client_id', { length: 50 }).notNull().references(() => clients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopes: varchar('scopes', { length: 200 }).notNull(),
  revoked: timestamp('revoked', { withTimezone: true }),
  authTime: timestamp('auth_time', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (t) => [
  index('idx_refresh_tokens_client').on(t.clientId),
  index('idx_refresh_tokens_user').on(t.userId),
]);

/**
 * JWKS 密钥对
 */
export const jwks = pgTable('jwks', {
  id: uuid('id').primaryKey().defaultRandom(),
  kid: varchar('kid', { length: 50 }).notNull().unique(),
  algorithm: varchar('algorithm', { length: 10 }).default('ES256'),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: createdAtColumn(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});
