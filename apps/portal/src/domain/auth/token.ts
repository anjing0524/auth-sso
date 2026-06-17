/**
 * Token 领域服务 (Token Domain Service)
 *
 * JWT 签发、验签、Refresh Token 轮换。
 * 使用 jose + DB JWKS 私钥进行 ES256 签名。
 *
 * 两个签发入口：
 * - signSessionJwt()  → Portal 自身登录后的 Session JWT（含完整 claims）
 * - signAccessToken() → OAuth 2.1 授权码流程，给外部 Client 的 Access Token
 *
 * 二者实现相同，语义区分第一方 vs 第三方。
 *
 * @module domain/auth/token
 */
import { SignJWT, jwtVerify, importJWK, generateKeyPair, exportJWK } from 'jose';
import { db, schema } from '@/infrastructure/db';
import { eq, and } from 'drizzle-orm';
import { generateId } from '@/lib/crypto';
import { getIssuer } from '@/lib/env';
import { isJtiRevoked } from '@/lib/session/revoke';
import type { PortalJwtClaims, RefreshTokenResult } from './types';

// ────────────────────────────────────────────
// 密钥管理（带模块级内存缓存）
// JWKS 密钥 90 天轮换一次，缓存 5 分钟避免每次验签都查 DB。
// ────────────────────────────────────────────

const KEY_CACHE_TTL_MS = 300_000; // 5min

interface CachedSigningKey {
  keyId: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  fetchedAt: number;
}

let cachedKey: CachedSigningKey | null = null;

async function getActiveSigningKey(): Promise<{
  keyId: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
}> {
  // 缓存命中 → 零 DB 查询
  if (cachedKey && Date.now() - cachedKey.fetchedAt < KEY_CACHE_TTL_MS) {
    return cachedKey;
  }

  const rows = await db
    .select()
    .from(schema.jwks)
    .orderBy(schema.jwks.createdAt)
    .limit(1);

  if (rows.length === 0) {
    return generateAndPersistKeyPair();
  }

  const jwk = rows[0]!;
  if (jwk.expiresAt && new Date(jwk.expiresAt) < new Date()) {
    return generateAndPersistKeyPair();
  }

  const privateJwk = JSON.parse(jwk.privateKey) as JsonWebKey;
  const publicJwk = JSON.parse(jwk.publicKey) as JsonWebKey;
  const privateKey = await importJWK(privateJwk, 'ES256') as CryptoKey;

  // 写入缓存
  cachedKey = { keyId: jwk.id, privateKey, publicJwk, fetchedAt: Date.now() };
  return cachedKey;
}

async function generateAndPersistKeyPair(): Promise<{
  keyId: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
}> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);

  const kid = generateId(16);
  const id = generateId(20);
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  await db.insert(schema.jwks).values({
    id,
    publicKey: JSON.stringify(publicJwk),
    privateKey: JSON.stringify(privateJwk),
    createdAt: new Date(),
    expiresAt,
  });

  // 新 key 生成后立即更新缓存，下次 getActiveSigningKey 直接命中
  cachedKey = { keyId: kid, privateKey, publicJwk, fetchedAt: Date.now() };
  return cachedKey;
}

// ────────────────────────────────────────────
// Login Session Token（登录后传给 authorize 的临时凭证）
// ────────────────────────────────────────────

export const LOGIN_SESSION_TTL = 300; // 5min，一次性的临时凭证

/**
 * 签发 Login Session Token — 登录成功后写入 HttpOnly Cookie，authorize 端点自动从 Cookie 读取。
 * 仅含 sub，5min TTL。不设 portal_jwt_token——真正的 Access Token 在 OAuth callback 完成后才设置。
 */
export async function signLoginSession(userId: string): Promise<string> {
  const { keyId, privateKey } = await getActiveSigningKey();
  const issuer = getIssuer();

  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience('portal-client')
    .setJti(`login_${generateId(16)}`)
    .setExpirationTime(Math.floor(Date.now() / 1000) + LOGIN_SESSION_TTL)
    .sign(privateKey);
}

// ────────────────────────────────────────────
// OAuth Access Token（第三方 Client）
// ────────────────────────────────────────────

export const ACCESS_TOKEN_TTL = 3600; // 1h

/**
 * 签发 OAuth Access Token (ES256 JWT)
 */
export async function signAccessToken(
  claims: Pick<PortalJwtClaims, 'sub' | 'roles' | 'permissions' | 'deptId' | 'dataScopeType'>,
  audience: string = 'portal-client',
): Promise<{ token: string; jti: string }> {
  const { keyId, privateKey } = await getActiveSigningKey();
  const jti = `jti_${generateId(16)}`;
  const issuer = getIssuer();

  const token = await new SignJWT({
    sub: claims.sub,
    roles: claims.roles,
    permissions: claims.permissions,
    deptId: claims.deptId,
    dataScopeType: claims.dataScopeType,
  })
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(jti)
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL)
    .sign(privateKey);

  return { token, jti };
}

/**
 * 验签并解析 JWT（Portal Session 和 OAuth Access Token 通用）
 */
export async function verifyAccessToken(token: string): Promise<PortalJwtClaims | null> {
  try {
    const { publicJwk } = await getActiveSigningKey();
    const publicKey = await importJWK(publicJwk, 'ES256') as CryptoKey;

    const { payload } = await jwtVerify<PortalJwtClaims>(token, publicKey, {
      issuer: getIssuer(),
      algorithms: ['ES256'],
    });

    if (payload.jti && (await isJtiRevoked(payload.jti))) {
      console.warn('[Token] JWT jti 在黑名单中:', payload.jti);
      return null;
    }

    return payload;
  } catch (error) {
    console.warn('[Token] JWT 验签失败:', error instanceof Error ? error.message : error);
    return null;
  }
}

// ────────────────────────────────────────────
// Refresh Token（OAuth 流程专用）
// ────────────────────────────────────────────

export const REFRESH_TOKEN_TTL = 7 * 24 * 3600; // 7d

export async function issueRefreshToken(
  userId: string,
  clientId: string,
  scopes: string = 'openid profile email offline_access',
): Promise<string> {
  const id = generateId(20);
  const token = `rt_${generateId(32)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL * 1000);

  await db.insert(schema.refreshTokens).values({
    id,
    token,
    clientId,
    userId,
    scopes,
    createdAt: now,
    expiresAt,
  });

  return token;
}

export async function rotateRefreshToken(
  oldRefreshToken: string,
  clientId: string,
): Promise<RefreshTokenResult | null> {
  const rows = await db
    .select()
    .from(schema.refreshTokens)
    .where(and(eq(schema.refreshTokens.token, oldRefreshToken), eq(schema.refreshTokens.clientId, clientId)))
    .limit(1);

  if (rows.length === 0) return null;
  const rt = rows[0]!;

  if (rt.revoked) {
    await db.update(schema.refreshTokens)
      .set({ revoked: new Date() })
      .where(and(eq(schema.refreshTokens.userId, rt.userId), eq(schema.refreshTokens.clientId, rt.clientId)))
      .execute();
    return null;
  }

  if (rt.expiresAt && new Date(rt.expiresAt) < new Date()) return null;

  await db.update(schema.refreshTokens)
    .set({ revoked: new Date() })
    .where(eq(schema.refreshTokens.id, rt.id))
    .execute();

  const newRefreshToken = await issueRefreshToken(rt.userId, rt.clientId, rt.scopes);

  const { getUserPermissionContext } = await import('@/lib/permissions');
  const permCtx = await getUserPermissionContext(rt.userId);
  if (!permCtx) return null;

  const { token: accessToken } = await signAccessToken({
    sub: rt.userId,
    roles: permCtx.roles.map((r) => r.code),
    permissions: permCtx.permissions,
    deptId: permCtx.deptId,
    dataScopeType: permCtx.dataScopeType,
  });

  return { accessToken, refreshToken: newRefreshToken, expiresIn: ACCESS_TOKEN_TTL };
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await db.update(schema.refreshTokens)
    .set({ revoked: new Date() })
    .where(eq(schema.refreshTokens.userId, userId))
    .execute();
}
