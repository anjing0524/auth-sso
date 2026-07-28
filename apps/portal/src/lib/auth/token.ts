import 'server-only';

/**
 * Token 签发 / 验签 / 轮换（server-only async 函数集）
 *
 * 本文件处理 JWT 生命周期：LoginSession → AccessToken → ID Token → RefreshToken。
 * 密钥管理已下沉到 ./token/signing-keys.ts。
 *
 * @module lib/auth/token
 */
import { SignJWT, jwtVerify, decodeProtectedHeader } from 'jose';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { generateId, generateUUID, hashToken } from '@/lib/crypto';
import { isJtiRevoked, trackUserJti, revokeUserAccessByUserId } from '@/lib/session/revoke';
import { getUserPermissionContext, cacheUserPermissionContext } from '@/lib/permissions';
import { TOKEN_TTL } from '@auth-sso/contracts';
import type { PortalJwtClaims, RefreshTokenResult } from '@/domain/auth/types';
import { getActiveSigningKey, getSigningKeyByKid } from './token/signing-keys';
import { createLogger } from '@/lib/logger';
// 保持向后兼容：密钥管理函数仍从 @/lib/auth/token 可导入
export { getActiveSigningKey, getSigningKeyByKid } from './token/signing-keys';

const log = createLogger('Token');
const AUTH_SSO = 'auth-sso';

// ============================================================================
// Login Session Token — 登录成功后写入 HttpOnly Cookie 的临时凭证
// 仅含 sub，5min TTL，authorize 端点自动从 Cookie 读取
// ============================================================================

export const LOGIN_SESSION_TTL = TOKEN_TTL.LOGIN_SESSION;

/**
 * 【server-only async】签发 Login Session Token
 *
 * 调用方：`app/api/auth/login/route.ts`（POST /api/auth/login）
 *
 * 登录成功后由 login route 调用，结果写入 HttpOnly Cookie。
 * 仅含 sub，5min TTL。不设 portal_jwt_token — Access Token 在 OAuth callback 完成后才颁发。
 *
 * @param userId - 用户 ID (UUID)
 * @returns ES256 签名的 JWT 字符串
 */
export async function signLoginSession(userId: string): Promise<string> {
  const { keyId, privateKey } = await getActiveSigningKey();

  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuedAt()
    .setIssuer(AUTH_SSO)
    .setAudience(AUTH_SSO)
    .setJti(`jti_${generateId(16)}`)
    .setExpirationTime(Math.floor(Date.now() / 1000) + LOGIN_SESSION_TTL)
    .sign(privateKey);
}

// ============================================================================
// OAuth Access Token — 授权码流程中签发给第三方 Client
// ============================================================================

export const ACCESS_TOKEN_TTL = TOKEN_TTL.ACCESS_TOKEN; // 1h

/**
 * 【server-only async】签发 OAuth 2.1 Access Token (ES256 JWT)
 *
 * 调用方：`app/api/auth/oauth2/token/route.ts`（authorization_code + refresh_token grant）
 *
 * JWT 仅含 sub，权限信息通过 Redis 缓存传递，不在 JWT 中内嵌。
 *
 * @param userId - 用户 ID (UUID)
 * @returns token 字符串 + jti（用于后续撤销）
 */
export async function signAccessToken(userId: string, scope?: string): Promise<{ token: string; jti: string }> {
  const { keyId, privateKey } = await getActiveSigningKey();
  const jti = `jti_${generateId(16)}`;

  const token = await new SignJWT({ sub: userId, ...(scope ? { scope } : {}) })
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuedAt()
    .setIssuer(AUTH_SSO)
    .setAudience(AUTH_SSO)
    .setJti(jti)
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL)
    .sign(privateKey);

  try {
    await trackUserJti(userId, jti, ACCESS_TOKEN_TTL);
  } catch (e) {
    log.error('写入 user→jti 映射失败', { error: (e as Error).message });
  }

  return { token, jti };
}

/**
 * 【server-only async】验签并解析 JWT — Portal Session 和 OAuth Access Token 通用
 *
 * 调用方：`lib/auth/verify-jwt.ts` + `app/api/me/route.ts` + oauth2 各 route
 *
 * 步骤：decodeProtectedHeader 提取 header.kid → 按 kid 查公钥 → ES256 验签 → issuer 校验 → jti 黑名单检查
 * 与 Gateway 的离线验签逻辑对齐：通过 kid 精准匹配密钥，支持轮换后旧 token 仍可验签。
 *
 * @param token - JWT 字符串
 * @returns 解析后的 PortalJwtClaims，验签失败或已撤销返回 null
 */
export async function verifyAccessToken(
  token: string,
  audience: string | null = AUTH_SSO,
): Promise<PortalJwtClaims | null> {
  try {
    const header = decodeProtectedHeader(token);
    const kid = header.kid;
    if (!kid) {
      log.warn('JWT 缺少 kid header');
      return null;
    }

    const signingKey = await getSigningKeyByKid(kid);
    if (!signingKey) {
      log.warn('未找到 kid 对应的密钥', { kid });
      return null;
    }

    const verifyOpts: { issuer: string; algorithms: string[]; audience?: string } = {
      issuer: AUTH_SSO,
      algorithms: ['ES256'],
    };
    if (audience !== null) {
      verifyOpts.audience = audience;
    }
    const { payload } = await jwtVerify<PortalJwtClaims>(token, signingKey.publicKey, verifyOpts);

    if (payload.jti && (await isJtiRevoked(payload.jti))) {
      log.warn('JWT jti 在黑名单中', { jti: payload.jti });
      return null;
    }

    return payload;
  } catch (error) {
    log.warn('JWT 验签失败', { error: (error as Error).message });
    return null;
  }
}

// ============================================================================
// ID Token — OIDC Core 1.0 Section 2，scope=openid 时签发
// ============================================================================

/** ID Token TTL（1h），与 Access Token 对齐，OIDC 规范建议短于 Access Token */
export const ID_TOKEN_TTL = TOKEN_TTL.ACCESS_TOKEN;

/**
 * 【server-only async】签发 OIDC ID Token (ES256 JWT)
 *
 * 调用方：`app/api/auth/oauth2/token/route.ts`（authorization_code grant → scope 含 openid）
 *
 * OIDC Core 1.0 Section 2 要求的 claims：
 *   iss — Issuer URL（与 Access Token 一致）
 *   sub — 用户唯一标识
 *   aud — OAuth client_id（Token 的目标消费方）
 *   exp — 过期时间（1h）
 *   iat — 签发时间
 *   auth_time — 最终用户认证时刻（取 authorization_codes.createdAt）
 *   nonce — 授权请求传入的 nonce（防重放），仅当请求携带时写入
 *
 * @param params.userId   - 用户内部 ID
 * @param params.clientId - OAuth client_id（JWT aud 声明）
 * @param params.nonce    - 授权请求携带的 nonce 值（可选）
 * @param params.authTime - 用户认证时间（authorization_codes.createdAt）
 * @returns ES256 签名的 ID Token JWT 字符串
 */
export async function signIdToken(params: {
  userId: string;
  clientId: string;
  nonce?: string | null;
  authTime: Date;
}): Promise<string> {
  const { keyId, privateKey } = await getActiveSigningKey();
  const now = Math.floor(Date.now() / 1000);

  const payload: Record<string, unknown> = {
    sub: params.userId,
    aud: params.clientId,
    auth_time: Math.floor(params.authTime.getTime() / 1000),
  };

  if (params.nonce) {
    payload['nonce'] = params.nonce;
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuedAt()
    .setIssuer(AUTH_SSO)
    .setAudience(params.clientId)
    .setJti(`jti_${generateId(16)}`)
    .setExpirationTime(now + ID_TOKEN_TTL)
    .sign(privateKey);
}

// ============================================================================
// Refresh Token — OAuth 2.1 流程专用，长期凭证，支持轮换
// ============================================================================

export const REFRESH_TOKEN_TTL = TOKEN_TTL.REFRESH_TOKEN; // 7d

/**
 * 【server-only async】签发 Refresh Token 并写入 DB
 *
 * 调用方：`app/api/auth/oauth2/token/route.ts`（authorization_code grant）
 *
 * @param userId - 用户内部 ID
 * @param scopes - 授权范围，默认 "openid profile email offline_access"
 * @returns Refresh Token 字符串
 */
export async function issueRefreshToken(
  userId: string,
  scopes: string = 'openid profile email offline_access',
): Promise<string> {
  const id = generateUUID();
  const token = `rt_${generateId(32)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL * 1000);

  await db.insert(schema.refreshTokens).values({
    id,
    tokenHash: hashToken(token),
    userId,
    scopes,
    createdAt: now,
    expiresAt,
  });

  return token;
}

/**
 * 【server-only async】轮换 Refresh Token — 撤销旧 token，签发新 token + Access Token
 *
 * 调用方：`oauth2/token/route.ts`(refresh_token) + `auth/refresh/route.ts`
 *
 * 安全：旧 token 已撤销 → 级联撤销同用户全部 Refresh Token（防盗用）
 * Refresh Token 为用户级（不绑定 client_id），级联吊销范围覆盖用户维度。
 *
 * @param oldRefreshToken - 旧的 Refresh Token
 * @returns 新的 accessToken + refreshToken + expiresIn，失败返回 null
 */
export async function rotateRefreshToken(
  oldRefreshToken: string,
): Promise<RefreshTokenResult | null> {
  const lockedRt = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ rt: schema.refreshTokens })
      .from(schema.refreshTokens)
      .where(
        eq(schema.refreshTokens.tokenHash, hashToken(oldRefreshToken)),
      )
      .for('update')
      .limit(1);

    if (rows.length === 0) return null;
    const rt = rows[0]!.rt;

    if (rt.revoked) {
      await tx
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        .where(eq(schema.refreshTokens.userId, rt.userId));
      return null;
    }

    if (rt.expiresAt && new Date(rt.expiresAt) < new Date()) return null;

    await tx
      .update(schema.refreshTokens)
      .set({ revoked: new Date() })
      .where(eq(schema.refreshTokens.id, rt.id));

    const newRtId = generateUUID();
    const newRtToken = `rt_${generateId(32)}`;
    const now = new Date();
    await tx.insert(schema.refreshTokens).values({
      id: newRtId,
      tokenHash: hashToken(newRtToken),
      userId: rt.userId,
      scopes: rt.scopes,
      createdAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL * 1000),
    });

    return { rt, newRefreshToken: newRtToken };
  });

  if (!lockedRt) return null;
  const { rt, newRefreshToken } = lockedRt;

  const permCtx = await getUserPermissionContext(rt.userId);
  if (!permCtx) return null;
  await cacheUserPermissionContext(rt.userId, permCtx);

  const { token: accessToken } = await signAccessToken(rt.userId, rt.scopes);

  return { accessToken, refreshToken: newRefreshToken, expiresIn: ACCESS_TOKEN_TTL };
}

/**
 * 【server-only async】撤销某用户全部 Refresh Token — 账户封禁/强制下线场景
 *
 * @param userId - 用户内部 ID
 */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await db.update(schema.refreshTokens)
    .set({ revoked: new Date() })
    .where(eq(schema.refreshTokens.userId, userId));

  // 同步撤销所有 Access Token 的 JTI（双层撤销闭环）
  try {
    const count = await revokeUserAccessByUserId(userId);
    if (count > 0) log.info('已撤销用户 Access Token JTI', { userId, count });
  } catch (e) {
    log.error('撤销用户 Access Token JTI 失败', { error: (e as Error).message });
  }
}
