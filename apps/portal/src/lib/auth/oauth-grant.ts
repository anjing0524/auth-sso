import 'server-only';

/**
 * OAuth 2.1 `authorization_code` 授权类型 —— 授权码兑换编排
 *
 * 把「原子领取授权码 → PKCE 校验 → 权限上下文预填充 → 签发 AT/RT/ID Token」
 * 收进一个 module，使 token 路由退化为「读请求 → 调本模块 → 写响应」。
 *
 * @module lib/auth/oauth-grant
 */
import { db, schema } from '@/infrastructure/db';
import { eq, and, gt } from 'drizzle-orm';
import type { OAuthTokenResponse } from '@/domain/auth/types';
import { verifyPKCE } from '@/domain/auth/oauth-code';
import { parseScopes } from '@/domain/auth/oauth-authorize';
import { getUserPermissionContext, cacheUserPermissionContext } from '@/lib/permissions';
// 从 ./token 导入而非直接 ./token/revocation：token.ts 是 token 族的模块边界
// （re-export 撤销原语），经它导入也让测试对 @/lib/auth/token 的 mock 生效。
import {
  ACCESS_TOKEN_TTL,
  issueRefreshToken,
  revokeRefreshTokenFamily,
  signAccessToken,
  signIdToken,
} from './token';
import { createLogger } from '@/lib/logger';

const log = createLogger('OAuthGrant');

/** 兑换请求：已通过 client 凭证认证与协议校验的输入 */
export interface AuthorizationCodeExchange {
  /** 授权码明文 */
  readonly code: string;
  /**
   * 已认证的 OAuth Client。
   *
   * 只要求 `clientId`：本模块不需要 client 的其余字段。刻意的窄接口——
   * 家族撤销锚点取自**授权码行**（`authCode.userId` + `authCode.clientId`），
   * 而非调用方传入的 client，避免调用方传错就撤错家族。
   */
  readonly client: { readonly clientId: string };
  /** 已与授权请求比对过的 redirect_uri（RFC 6749 §4.1.3 必填） */
  readonly redirectUri: string;
  /** PKCE code_verifier 明文 */
  readonly codeVerifier: string;
}

/**
 * 兑换结果。
 *
 * 失败分两种**语义不同**的情形——这个区分不是装饰：
 * `authorization_code_replayed` 是本模块能识别出的**安全事件**（已消费的授权码被
 * 二次兑换 = 疑似泄露，RFC 9700 §4.2.4），调用方必须为它留审计痕迹；
 * `invalid_grant` 是常规拒绝（不存在 / 已过期 / PKCE 失败 / redirect_uri 不匹配）。
 *
 * 因此不采用 `Result | null`（会把两者压成同形），也不在本模块内直接写审计日志
 * （那会让"为何失败"这一信息无法在测试中被断言）。
 */
export type AuthorizationCodeExchangeResult =
  | { readonly ok: true; readonly tokens: OAuthTokenResponse }
  | { readonly ok: false; readonly reason: 'authorization_code_replayed' }
  | { readonly ok: false; readonly reason: 'invalid_grant'; readonly detail: string };

/**
 * 原子领取授权码。
 *
 * 并发请求中仅一个能把它从 `used = false` 更新为 `used = true`——这是"一次性使用"
 * 的实现方式（条件 UPDATE + RETURNING，而非先读后写）。
 *
 * PKCE 校验失败后授权码**同样保持已消费**：避免攻击者拿到一个仍然有效的 code
 * 用于离线穷举 verifier。
 */
async function claimAuthorizationCode(
  code: string,
  clientId: string,
): Promise<typeof schema.authorizationCodes.$inferSelect | null> {
  const [claimed] = await db
    .update(schema.authorizationCodes)
    .set({ used: true })
    .where(and(
      eq(schema.authorizationCodes.code, code),
      eq(schema.authorizationCodes.clientId, clientId),
      eq(schema.authorizationCodes.used, false),
      gt(schema.authorizationCodes.expiresAt, new Date()),
    ))
    .returning();
  return claimed ?? null;
}

/**
 * 若该 code 属于本 client 且**已被消费**，返回其持有者信息（用于重放取证），否则 null。
 *
 * 为什么必须确认"已存在且已消费"才能认定重放：普通坏 code / 过期 code 若也触发
 * 家族撤销，攻击者就能拿随机 code 借本端点撤销他人家族（DoS 放大）。RFC 9700 §4.2.4。
 */
async function findConsumedCode(
  code: string,
  clientId: string,
): Promise<{ userId: string; clientId: string } | null> {
  const [row] = await db
    .select({
      userId: schema.authorizationCodes.userId,
      clientId: schema.authorizationCodes.clientId,
    })
    .from(schema.authorizationCodes)
    .where(and(
      eq(schema.authorizationCodes.code, code),
      eq(schema.authorizationCodes.clientId, clientId),
      eq(schema.authorizationCodes.used, true),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * 兑换授权码为令牌。
 *
 * 失败语义见 {@link AuthorizationCodeExchangeResult}。
 */
export async function exchangeAuthorizationCode(
  input: AuthorizationCodeExchange,
): Promise<AuthorizationCodeExchangeResult> {
  const { code, client, redirectUri, codeVerifier } = input;
  const clientId = client.clientId;

  // ── 1. 原子领取（一次性使用的实现点）──
  const authCode = await claimAuthorizationCode(code, clientId);

  if (!authCode || authCode.redirectUri !== redirectUri) {
    // 领取失败才可能与重放有关：确认该 code 是否确实存在且已消费
    if (!authCode) {
      const consumed = await findConsumedCode(code, clientId);
      if (consumed) {
        // 重放取证：撤销同一授权家族（userId + clientId）的全部 RT
        await revokeRefreshTokenFamily(db, consumed.userId, consumed.clientId);
        log.warn('授权码重放：已撤销同家族 Refresh Token', { clientId });
        return { ok: false, reason: 'authorization_code_replayed' };
      }
    }
    return {
      ok: false,
      reason: 'invalid_grant',
      detail: '授权码无效、已使用、已过期或 redirect_uri 不匹配',
    };
  }

  // ── 2. PKCE（OAuth 2.1 强制：授权码必须携带 code_challenge）──
  if (!authCode.codeChallenge || authCode.codeChallengeMethod !== 'S256') {
    return { ok: false, reason: 'invalid_grant', detail: '授权码缺少 PKCE code_challenge' };
  }
  await verifyPKCE(codeVerifier, authCode.codeChallenge);

  // ── 3. 权限上下文预填充（使后续请求总是 Redis 命中）──
  //
  // 这里必须区分两种失败（ADR-011 / ADR-018）：
  // - 用户已不存在 / 非 ACTIVE → 不签发（否决性数据；码签发后被禁用/删除）
  // - 数据库不可用 → **不阻断签发**，只跳过预填充。签发令牌不依赖权限上下文，
  //   而预填充是纯粹的优化：跳过它意味着该用户首次鉴权时解析一次（fail-open 路径）。
  //   原实现把两者都 fail-close，使一次 DB 抖动变成用户被登出。
  const permResult = await getUserPermissionContext(authCode.userId);
  if (permResult.kind === 'denied') {
    return { ok: false, reason: 'invalid_grant', detail: '用户不可用' };
  }
  if (permResult.kind === 'ok') {
    await cacheUserPermissionContext(authCode.userId, permResult.context);
  }

  // ── 4. 签发 ──
  // AT：aud / client_id = 授权对象 client（ADR-013）
  const { token: accessToken } = await signAccessToken(authCode.userId, clientId, authCode.scope);

  // RT：按 offline_access 门控（OIDC Core §11：长期凭证仅在明确请求时发放）
  const grantedScopes = parseScopes(authCode.scope);
  const refreshToken = grantedScopes.includes('offline_access')
    ? await issueRefreshToken(authCode.userId, clientId, authCode.scope)
    : undefined;

  // ID Token：scope 含 openid 时签发
  const idToken = grantedScopes.includes('openid')
    ? await signIdToken({
        userId: authCode.userId,
        clientId,
        nonce: authCode.nonce,
        authTime: authCode.createdAt,
      })
    : undefined;

  return {
    ok: true,
    tokens: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      ...(idToken ? { id_token: idToken } : {}),
      scope: authCode.scope,
    },
  };
}
