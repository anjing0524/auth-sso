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
import { eq, and } from 'drizzle-orm';
import { generateId, generateUUID, hashToken } from '@/lib/crypto';
import { getIssuer } from '@/lib/env';
import { isJtiRevoked, trackUserJti, revokeUserAccessByUserId } from '@/lib/session/revoke';
import { cacheUserPermissionContext } from '@/lib/permissions';
import { resolveTokenClaims } from '@/lib/auth/permissions-context';
import { TOKEN_TTL } from '@auth-sso/contracts';
import type { PortalJwtClaims, RefreshTokenResult } from '@/domain/auth/types';
import { getActiveSigningKey, getSigningKeyByKid } from './token/signing-keys';
import { createLogger } from '@/lib/logger';
// 保持向后兼容：密钥管理函数仍从 @/lib/auth/token 可导入
export { getActiveSigningKey, getSigningKeyByKid } from './token/signing-keys';

const log = createLogger('Token');

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
  const issuer = getIssuer();

  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience('portal-client')
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
 * 调用方：`app/api/auth/oauth2/token/route.ts`（POST /oauth2/token + refresh_token grant）
 *
 * @param claims   - 含 sub / roles / permissions / deptIds 的载荷
 * @param audience - JWT aud 声明，默认 'portal-client'
 * @returns token 字符串 + jti（用于后续撤销）
 */
export async function signAccessToken(
  claims: Pick<PortalJwtClaims, 'sub' | 'roles' | 'permissions' | 'deptIds'>,
  audience: string = 'portal-client',
  persist?: { clientId: string; scopes?: string },
): Promise<{ token: string; jti: string }> {
  const { keyId, privateKey } = await getActiveSigningKey();
  const jti = `jti_${generateId(16)}`;
  const issuer = getIssuer();

  const token = await new SignJWT({
    sub: claims.sub,
    roles: claims.roles,
    permissions: claims.permissions,
    deptIds: claims.deptIds,
  })
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(jti)
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL)
    .sign(privateKey);

  // 建立 userId → jti 映射（Token 签发方维护，用于管理员按用户 ID 紧急撤销）
  // Gateway 仅读取 jti 黑名单，不维护此映射
  try {
    await trackUserJti(claims.sub, jti, ACCESS_TOKEN_TTL);
  } catch (e) {
    log.error('写入 user→jti 映射失败', { error: (e as Error).message });
  }

  // 持久化到 access_tokens 表（供 Client 详情页 Token 列表 / 审计查看）
  // 仅持久化元数据：tokenHash = SHA256(token)，不存 JWT 明文。
  // 撤销生效仍靠 Redis jti 黑名单（Gateway 离线验签不查 DB）；此处仅做审计可见性，
  // 失败不阻断签发（认证可用性优先于审计完整性）。
  if (persist) {
    try {
      await db.insert(schema.accessTokens).values({
        tokenHash: hashToken(token),
        clientId: persist.clientId,
        userId: claims.sub,
        scopes: persist.scopes ?? '',
        expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL * 1000),
      });
    } catch (e) {
      log.error('Access Token 入库失败', { error: (e as Error).message });
    }
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
  audience: string | null = 'portal-client',
): Promise<PortalJwtClaims | null> {
  try {
    // 1. 不解码验签，仅提取 header.kid 定位公钥（与 Gateway 的 decode_header + get_key 对齐）
    const header = decodeProtectedHeader(token);
    const kid = header.kid;
    if (!kid) {
      log.warn('JWT 缺少 kid header');
      return null;
    }

    // 2. 按 kid 查找公钥
    const signingKey = await getSigningKeyByKid(kid);
    if (!signingKey) {
      log.warn('未找到 kid 对应的密钥', { kid });
      return null;
    }

    // 3. ES256 验签 + issuer + audience 校验（audience 为 null 时跳过，用于 UserInfo 等不区分 client 的场景）
    // 直接使用缓存的 publicKey（CryptoKey），避免热路径重复 importJWK 开销
    const verifyOpts: { issuer: string; algorithms: string[]; audience?: string } = {
      issuer: getIssuer(),
      algorithms: ['ES256'],
    };
    if (audience !== null) {
      verifyOpts.audience = audience;
    }
    const { payload } = await jwtVerify<PortalJwtClaims>(token, signingKey.publicKey, verifyOpts);

    // 4. jti 黑名单检查
    if (payload.jti && (await isJtiRevoked(payload.jti))) {
      log.warn('JWT jti 在黑名单中', { jti: payload.jti });
      return null;
    }

    // 归一化：确保必填字段有默认值（Token 签发时总是包含，此处为运行时安全兜底）
    // 若签发端因回归漏设这些字段，记录告警以便快速发现签发 Bug
    if (!payload.roles || !payload.permissions || !payload.deptIds) {
      log.warn('JWT 载荷缺少权限关键字段（签发端可能漏设）', {
        sub: payload.sub,
        hasRoles: !!payload.roles,
        hasPermissions: !!payload.permissions,
        hasDeptIds: !!payload.deptIds,
      });
    }
    return {
      ...payload,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
      deptIds: payload.deptIds ?? [],
    };
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
  const issuer = getIssuer();
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
    .setIssuer(issuer)
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
 * @param userId   - 用户内部 ID
 * @param clientId - OAuth Client ID
 * @param scopes   - 授权范围，默认 "openid profile email offline_access"
 * @returns Refresh Token 字符串
 */
export async function issueRefreshToken(
  userId: string,
  clientId: string,
  scopes: string = 'openid profile email offline_access',
): Promise<string> {
  const id = generateUUID();
  const token = `rt_${generateId(32)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL * 1000);

  await db.insert(schema.refreshTokens).values({
    id,
    // 仅存 SHA256(token)，明文 token 仅返回给调用方，不落库（见 hashToken）
    tokenHash: hashToken(token),
    clientId,
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
 * 安全：旧 token 已撤销 → 级联撤销同用户同 Client 全部 token（防盗用）
 *
 * @param oldRefreshToken - 旧的 Refresh Token
 * @param clientId         - OAuth Client ID
 * @returns 新的 accessToken + refreshToken + expiresIn，失败返回 null
 */
export async function rotateRefreshToken(
  oldRefreshToken: string,
  clientId: string,
): Promise<RefreshTokenResult | null> {
  // 事务 + FOR UPDATE 行锁：串行化对同一条 RT 的并发轮换。
  // 多应用/多标签页并发续签时，第二个请求会被阻塞到第一个提交，
  // 随后读到 revoked=true → 触发级联吊销 → 返回 null，避免重复签发与误触发级联吊销。
  //
  // 将「撤销旧 RT → 签发新 RT」纳入同一事务，保证原子性：
  // 若进程在事务提交后崩溃，旧 RT 已撤销 + 新 RT 已写入 → 用户持有新 RT 可续签；
  // 若进程在事务提交前崩溃，旧 RT 未撤销 → 用户可用旧 RT 重试。
  // Access Token 签发仍放事务外（AT 为无状态 JWT，崩溃丢失无副作用）。
  const lockedRt = await db.transaction(async (tx) => {
    // join clients 取 isInternal，用于决定续签后 AT 的 audience
    // （不靠 clientId 字符串比较判断是否为内部客户端）
    const rows = await tx
      .select({
        rt: schema.refreshTokens,
        isInternal: schema.clients.isInternal,
      })
      .from(schema.refreshTokens)
      .innerJoin(schema.clients, eq(schema.refreshTokens.clientId, schema.clients.clientId))
      .where(
        and(
          // 查询时同样使用 SHA256(token)，与写入保持一致
          eq(schema.refreshTokens.tokenHash, hashToken(oldRefreshToken)),
          eq(schema.refreshTokens.clientId, clientId),
        ),
      )
      .for('update') // SELECT ... FOR UPDATE，锁住该行直到事务提交
      .limit(1);

    if (rows.length === 0) return null;
    const { rt, isInternal } = rows[0]!;

    // 已撤销 → 级联撤销该用户在此 Client 下的所有 token（防盗用）
    if (rt.revoked) {
      await tx
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        .where(
          and(
            eq(schema.refreshTokens.userId, rt.userId),
            eq(schema.refreshTokens.clientId, rt.clientId),
          ),
        );
      return null;
    }

    if (rt.expiresAt && new Date(rt.expiresAt) < new Date()) return null;

    // 撤销旧 token
    await tx
      .update(schema.refreshTokens)
      .set({ revoked: new Date() })
      .where(eq(schema.refreshTokens.id, rt.id));

    // 在同一事务中签发新 Refresh Token（保证原子性：旧 RT 撤销 + 新 RT 写入）
    const newRtId = generateUUID();
    const newRtToken = `rt_${generateId(32)}`;
    const now = new Date();
    await tx.insert(schema.refreshTokens).values({
      id: newRtId,
      tokenHash: hashToken(newRtToken),
      clientId: rt.clientId,
      userId: rt.userId,
      scopes: rt.scopes,
      createdAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL * 1000),
    });

    return { rt, isInternal, newRefreshToken: newRtToken };
  });

  // 事务返回 null：RT 不存在 / 已撤销（级联吊销）/ 已过期
  if (!lockedRt) return null;
  const { rt, isInternal, newRefreshToken } = lockedRt;

  // 获取最新权限上下文并签发新 Access Token（静态 import 中间层，消除循环依赖）
  const resolved = await resolveTokenClaims(rt.userId);
  if (!resolved) return null;
  const { permCtx, deptIds } = resolved;

  // aud 语义：内部客户端（Portal 自身会话，isInternal=true）用 'portal-client'；
  // 第三方 OAuth Client 续签时沿用其 client_id，保持与授权码首签一致。
  // 判断依据是 clients.isInternal 结构化标记，而非 clientId 字符串比较。
  const audience = isInternal ? 'portal-client' : rt.clientId;
  const { token: accessToken } = await signAccessToken(
    {
      sub: rt.userId,
      roles: permCtx.roles.map((r) => r.code),
      permissions: permCtx.permissions,
      deptIds,
    },
    audience,
    { clientId: rt.clientId, scopes: rt.scopes },
  );

  // 主动写 Redis 权限缓存，TTL 与 Token 对齐
  try {
    await cacheUserPermissionContext(rt.userId, permCtx, ACCESS_TOKEN_TTL);
  } catch (e) {
    log.error('刷新时写权限缓存失败', { error: (e as Error).message });
  }

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
