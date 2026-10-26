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
import { isJtiRevoked, trackUserJti, revokeUserAccessByUserId, type UserRevokeOutcome } from '@/lib/session/revoke';
import { resolveIssuancePermission } from '@/lib/permissions';
import { DEFAULT_SCOPES, PORTAL_AUD, TOKEN_TTL, JWT_TYP } from '@auth-sso/contracts';
import { getIssuer } from '@/lib/env';
import type { PortalJwtClaims, RefreshTokenResult } from '@/domain/auth/types';
import { getActiveSigningKey, getSigningKeyByKid } from './token/signing-keys';
import { revokeRefreshTokenById, revokeRefreshTokenFamily, revokeUserRefreshTokens, type RevocationExecutor } from './token/revocation';
import { createLogger } from '@/lib/logger';
// 保持向后兼容：密钥管理函数仍从 @/lib/auth/token 可导入
export { getActiveSigningKey, getSigningKeyByKid } from './token/signing-keys';

const log = createLogger('Token');

/** jti 统一格式：`jti_` + 16 位随机 ID — 三个签发函数共用，防格式漂移 */
function newJti(): string {
  return `jti_${generateId(16)}`;
}

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
 * 5min TTL。不设 portal_jwt_token — Access Token 在 OAuth callback 完成后才颁发。
 *
 * @param userId - 用户 ID (UUID)
 * @param sessionId - 已通过绑定校验的授权请求 session_id（H-02；普通登录省略）
 * @returns ES256 签名的 JWT 字符串
 */
export async function signLoginSession(userId: string, sessionId?: string): Promise<string> {
  const { keyId, privateKey } = await getActiveSigningKey();
  const payload: Record<string, unknown> = { sub: userId };
  // sid 让 authorize 分支 A 能拒绝"登录凭证与 URL 中 session_id 不匹配"的注入请求
  if (sessionId) payload['sid'] = sessionId;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: JWT_TYP.LOGIN_SESSION })
    .setIssuedAt()
    .setIssuer(getIssuer())
    .setAudience(PORTAL_AUD)
    .setJti(newJti())
    .setExpirationTime(Math.floor(Date.now() / 1000) + LOGIN_SESSION_TTL)
    .sign(privateKey);
}

// ============================================================================
// OAuth Access Token — 授权码流程中签发给第三方 Client
// ============================================================================

export const ACCESS_TOKEN_TTL = TOKEN_TTL.ACCESS_TOKEN; // 1h

/**
 * per-client TTL 的服务端钳制边界（H-16）。
 *
 * clients 表的 access_token_ttl / refresh_token_ttl 已可被管理员配置，但签发此前
 * 恒用全局常量（死配置）。读取 client 配置时必须钳制：过短会让 RP 在正常请求间
 * 频繁失败，过长会削弱撤销杠杆（ADR-013 决策 4 的核心假设是 AT ≤1h）。
 */
export const ACCESS_TOKEN_TTL_BOUNDS = { min: 60, max: 24 * 60 * 60 } as const;
export const REFRESH_TOKEN_TTL_BOUNDS = { min: 5 * 60, max: 30 * 24 * 60 * 60 } as const;

/**
 * 把 client 配置的 TTL 收敛到合法区间；非法/缺失回退到全局默认（禁止抛错）。
 *
 * 非数字、非有限数、≤0 一律视为"未配置"（列有 DB 默认值，但服务端仍防御脏数据）。
 */
export function clampTokenTtl(
  rawTtl: number | null | undefined,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  if (typeof rawTtl !== 'number' || !Number.isFinite(rawTtl) || rawTtl <= 0) return fallback;
  return Math.min(Math.max(Math.floor(rawTtl), bounds.min), bounds.max);
}

/**
 * 【server-only async】签发 OAuth 2.1 Access Token (ES256 JWT)
 *
 * 调用方：`app/api/auth/oauth2/token/route.ts`（authorization_code + refresh_token grant）
 *
 * OAuth 协议数据携带（ADR-013）：aud = 签发对象 client_id，payload 显式含
 * client_id claim（与 aud 同源同值，RFC 9068 形态）；scope 随授权授予写入。
 * 权限信息通过 Redis 缓存传递，不在 JWT 中内嵌（ADR-006）。
 *
 * @param userId - 用户 ID (UUID)
 * @param clientId - 授权对象 OAuth client_id（aud 与 client_id claim 的唯一来源）
 * @param scope - 已授予 scope（空格分隔），未授予时省略
 * @param clientAccessTokenTtl - client 配置的 AT TTL（秒）；已钳制，非法值回退默认（H-16）
 * @returns token 字符串 + jti（用于后续撤销）+ 实际生效 TTL
 */
export async function signAccessToken(
  userId: string,
  clientId: string,
  scope?: string,
  clientAccessTokenTtl?: number | null,
  /** 当前 refresh 会话 id（写入 sid claim；个人中心据此标记“当前设备”） */
  sessionId?: string,
): Promise<{ token: string; jti: string; expiresIn: number }> {
  const { keyId, privateKey } = await getActiveSigningKey();
  const ttl = clampTokenTtl(clientAccessTokenTtl, ACCESS_TOKEN_TTL, ACCESS_TOKEN_TTL_BOUNDS);
  const jti = newJti();
  // 单一时刻同时作为 iat 与 exp 的基准：若让 `.setIssuedAt()` 自行读实时时钟，
  // 而 exp 另用 Date.now() 计算，两次读时钟跨越秒边界时
  // `exp - iat` 会比 ACCESS_TOKEN_TTL 少 1 秒，与响应的 `expires_in` 承诺不符，
  // 处在续期边界上的客户端会拿到 401。
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    sub: userId,
    client_id: clientId,
    ...(scope ? { scope } : {}),
    ...(sessionId ? { sid: sessionId } : {}),
  })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: JWT_TYP.ACCESS_TOKEN })
    .setIssuedAt(now)
    .setIssuer(getIssuer())
    .setAudience(clientId)
    .setJti(jti)
    .setExpirationTime(now + ttl)
    .sign(privateKey);

  try {
    await trackUserJti(userId, jti, ttl);
  } catch (e) {
    log.error('写入 user→jti 映射失败', { error: (e as Error).message });
  }

  return { token, jti, expiresIn: ttl };
}

/**
 * 【server-only async】验签并解析 JWT — Portal Session 和 OAuth Access Token 通用
 *
 * 调用方：`lib/auth/verify-jwt.ts` + `app/api/me/route.ts` + oauth2 各 route
 *
 * 步骤：decodeProtectedHeader 提取 header.kid → 按 kid 查公钥 → ES256 验签 → issuer 校验 → jti 黑名单检查
 * 与 Gateway 的离线验签逻辑对齐：通过 kid 精准匹配密钥，支持轮换后旧 token 仍可验签。
 *
 * typ 显式类型校验（RFC 8725 §3.11，与 Gateway `verify.rs` 对齐，ADR-013 决策 2）：
 * `expectedTyp` 传入时，header.typ **必须存在且相等**——缺失即拒（兼容窗不再开启）。
 *
 * @param token - JWT 字符串
 * @param audience - 预期 aud，必传显式语义：AT 用 `PORTAL_CLIENT_ID`、LoginSession 用
 *   `PORTAL_AUD`（体系级 auth-sso）；多 client 通用端点（userinfo/introspect）传 null 跳过校验
 * @param expectedTyp - 预期 typ（JWT_TYP），调用方按 token 用途传入；省略则不做 typ 校验
 * @returns 解析后的 PortalJwtClaims，验签失败或已撤销返回 null
 */
export async function verifyAccessToken(
  token: string,
  audience: string | null,
  expectedTyp?: string,
): Promise<PortalJwtClaims | null> {
  try {
    const header = decodeProtectedHeader(token);
    const kid = header.kid;
    if (!kid) {
      log.warn('JWT 缺少 kid header');
      return null;
    }

    // typ 必须存在且与预期用途一致（缺失即拒：ADR-013 决策 2 已关闭兼容窗，与 Gateway 对齐）
    if (expectedTyp && header.typ !== expectedTyp) {
      log.warn('JWT typ 与预期用途不匹配', { typ: header.typ, expected: expectedTyp });
      return null;
    }

    const signingKey = await getSigningKeyByKid(kid);
    if (!signingKey) {
      log.warn('未找到 kid 对应的密钥', { kid });
      return null;
    }

    // issuer 校验：env 驱动 URL（OIDC Discovery §4.3，与 discovery 同源，见 ADR-012）
    const verifyOpts: { issuer: string; algorithms: string[]; audience?: string } = {
      issuer: getIssuer(),
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
const ID_TOKEN_TTL = TOKEN_TTL.ACCESS_TOKEN;

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
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: JWT_TYP.ID_TOKEN })
    // 同 signAccessToken：iat 与 exp 必须同源，避免寿命比声明少 1 秒
    .setIssuedAt(now)
    .setIssuer(getIssuer())
    .setAudience(params.clientId)
    .setJti(newJti())
    .setExpirationTime(now + ID_TOKEN_TTL)
    .sign(privateKey);
}

// ============================================================================
// Refresh Token — OAuth 2.1 流程专用，长期凭证，支持轮换
// ============================================================================

const REFRESH_TOKEN_TTL = TOKEN_TTL.REFRESH_TOKEN; // 7d

/**
 * 【server-only async】签发 Refresh Token 并写入 DB
 *
 * 调用方：`app/api/auth/oauth2/token/route.ts`（authorization_code grant）
 *
 * RT 绑定发放时的 OAuth Client（RFC 9700 token family 最小语义）：
 * Gateway SSO 会话传 'portal'，直连 RP 传各自 client_id。
 *
 * @param userId - 用户内部 ID
 * @param clientId - 发放该 RT 的 OAuth Client
 * @param scopes - 授权范围，默认 DEFAULT_SCOPES（contracts 单一真相源）
 * @param clientRefreshTokenTtl - client 配置的 RT TTL（秒）；已钳制，非法值回退默认（H-16）
 * @returns Refresh Token 字符串
 */
export async function issueRefreshToken(
  userId: string,
  clientId: string,
  scopes: string = DEFAULT_SCOPES,
  clientRefreshTokenTtl?: number | null,
  /** 由调用方生成的会话 id（与 access token sid 一致；缺省则自生成） */
  sessionId?: string,
): Promise<string> {
  const id = sessionId ?? generateUUID();
  const token = `rt_${generateId(32)}`;
  const ttl = clampTokenTtl(clientRefreshTokenTtl, REFRESH_TOKEN_TTL, REFRESH_TOKEN_TTL_BOUNDS);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  await db.insert(schema.refreshTokens).values({
    id,
    tokenHash: hashToken(token),
    userId,
    clientId,
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
 * 安全（RFC 9700 §4.14 token family）：RT 绑定发放 client，重放检测命中后
 * 级联撤销范围 = (userId, clientId) —— 同一授权家族，而非该用户全部会话；
 * 其他 client 的会话不受牵连（消除跨 client DoS 放大）。
 * token 端点必须传入 expectedClientId 校验归属（sender 绑定强制）；
 * 不匹配视同泄露信号，撤销整个家族。Gateway 静默续签（/api/auth/refresh）
 * 无 client 上下文，不传该参数。
 *
 * @param oldRefreshToken - 旧的 Refresh Token
 * @param expectedClientId - 发起轮换的 OAuth client（token 端点必传）
 * @returns 新的 accessToken + refreshToken + expiresIn，失败返回 null
 */
// RT 撤销原语已收口到 ./token/revocation.ts（此前 12 处散落 SQL）；
// 家族撤销对既有调用方（token 端点重放取证）保持从本模块导出，签名新增 executor 首参。
export { revokeRefreshTokenFamily };

export async function rotateRefreshToken(
  oldRefreshToken: string,
  expectedClientId?: string,
): Promise<RefreshTokenResult | null> {
  const outcome = await db.transaction(async (tx) => {
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
      // RFC 9700 §4.14：轮换后的 RT 被重放 = 疑似泄露，撤销同一家族
      // （同用户 + 同 client）的全部 Refresh Token
      await revokeRefreshTokenFamily(tx, rt.userId, rt.clientId);
      return null;
    }

    if (rt.expiresAt && new Date(rt.expiresAt) < new Date()) return null;

    // sender 绑定强制（RFC 9700）：提交的 RT 不属于认证中的 client =
    // 疑似泄露/伪造，视同重放 —— 撤销该授权家族并拒绝
    if (expectedClientId && rt.clientId !== expectedClientId) {
      await revokeRefreshTokenFamily(tx, rt.userId, rt.clientId);
      return null;
    }

    await revokeRefreshTokenById(tx, rt.id);

    // H-16：per-client TTL —— 读发放 client 的配置（与授权码兑换路径同源）
    const [clientRow] = await tx
      .select({
        accessTokenTtl: schema.clients.accessTokenTtl,
        refreshTokenTtl: schema.clients.refreshTokenTtl,
      })
      .from(schema.clients)
      .where(eq(schema.clients.clientId, rt.clientId))
      .limit(1);
    const accessTtl = clampTokenTtl(clientRow?.accessTokenTtl, ACCESS_TOKEN_TTL, ACCESS_TOKEN_TTL_BOUNDS);
    const refreshTtl = clampTokenTtl(clientRow?.refreshTokenTtl, REFRESH_TOKEN_TTL, REFRESH_TOKEN_TTL_BOUNDS);

    const newRtId = generateUUID();
    const newRefreshToken = `rt_${generateId(32)}`;
    const now = new Date();
    await tx.insert(schema.refreshTokens).values({
      id: newRtId,
      tokenHash: hashToken(newRefreshToken),
      userId: rt.userId,
      clientId: rt.clientId,
      scopes: rt.scopes,
      createdAt: now,
      expiresAt: new Date(now.getTime() + refreshTtl * 1000),
    });

    return { rt, newRtId, newRefreshToken, accessTtl, refreshTtl };
  });

  if (!outcome) return null;
  const { rt, newRtId, newRefreshToken, accessTtl, refreshTtl } = outcome;

  // 事务已提交：以下任一失败必须补偿回收刚入库的新 RT —— 否则产生
  // "已入库但永不发放"的孤儿行（明文已丢弃，无人可用，但属垃圾数据）
  try {
    // 权限上下文预填充的分级（denied 拒绝 / unavailable 不阻断 / ok 预填充）住在
    // `resolveIssuancePermission` 里，与授权码兑换路径共用同一处判定（ADR-011 / ADR-018）。
    // 本路径把失败投递为**抛出**——下方 catch 要据此补偿回收刚入库的新 RT。
    const permission = await resolveIssuancePermission(rt.userId);
    if (!permission.ok) {
      throw new Error(`用户不可用（${permission.reason}），拒绝轮换`);
    }

    const { token: accessToken, expiresIn } = await signAccessToken(
      rt.userId,
      rt.clientId,
      rt.scopes,
      accessTtl,
      newRtId,
    );

    // scope 一并返回：协议响应必须回报授予范围（RFC 6749 §5.1），
    // 而此前 RefreshTokenResult 不带它 ⇒ 路由手拼响应时漏掉
    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
      refreshExpiresIn: refreshTtl,
      scope: rt.scopes,
    };
  } catch (e) {
    log.error('RT 轮换后置步骤失败，补偿回收新 RT', { error: (e as Error).message });
    try {
      // 仅回收新 RT 本身（不触发家族级联——infra 故障不应牵连其他会话）
      await revokeRefreshTokenById(db, newRtId);
    } catch (revokeErr) {
      log.error('补偿回收新 RT 失败', { error: (revokeErr as Error).message });
    }
    return null;
  }
}

/**
 * 【server-only async】撤销某用户全部 Refresh Token — 账户封禁/强制下线场景
 *
 * @param userId - 用户内部 ID
 */
/**
 * 撤销用户的全部 Refresh Token，并同步撤销其 Access Token 的 JTI（双层撤销闭环）。
 *
 * RT 撤销走 DB 且**失败即抛**（否决性数据 fail-close，ADR-011）——因此本函数正常
 * 返回就说明 RT 层已完成。返回值只描述**会部分失败的那一层**：jti 撤销是尽力而为
 * （Redis 故障既不抛错也不阻断），其成败必须由调用方消费，否则"没撤成"不可观测。
 * 失败的具体原因由 `lib/session/revoke` 在发生处记日志（含 userId）。
 *
 * ## executor 为什么是**必填首参**（2026-10-13 修订，架构评审 R2 候选 R11）
 *
 * 原签名只收 `userId`，内部固定用事务外的 `db`。调用方
 * （`/api/users/[id]/force-logout`）却在 `withScopedWrite` 的事务内做数据范围断言
 * ——于是"快照与写入同事务"这个不变量被打破：RT 撤销落在一个**没有范围断言**的
 * 事务里（ADR-014 / H-ACL-002 的 TOCTOU 窗口）。
 *
 * 与 {@link revokeUserRefreshTokens} 同形显式收 `executor`：**连接归属由调用方决定**，
 * 事务内的调用方传 `tx` 即把撤销绑进同一个事务。不用可选参数——那会退化成
 * "传不传都行"的条件参数化，而这里的正确性恰恰取决于调用方选对了执行器。
 *
 * @param executor db 直连（事务外）或事务句柄 `tx`
 * @param userId 用户内部 ID
 * @returns jti 层的 `{ revoked, failed }`
 */
export async function revokeAllRefreshTokens(
  executor: RevocationExecutor,
  userId: string,
): Promise<UserRevokeOutcome> {
  await revokeUserRefreshTokens(executor, userId);

  // 同步撤销所有 Access Token 的 JTI（双层撤销闭环）。
  // 刻意不需要 try/catch：该函数永不抛出，失败经返回值回报（此前那个 catch 不可达）。
  const outcome = await revokeUserAccessByUserId(userId);
  if (outcome.revoked > 0) {
    log.info('已撤销用户 Access Token JTI', { userId, count: outcome.revoked });
  }
  return outcome;
}
