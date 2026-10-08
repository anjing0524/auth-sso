/**
 * OAuth 2.1 Token 端点 (POST /api/auth/oauth2/token)
 *
 * 支持 grant_type: authorization_code（code 换 token）和 refresh_token（轮换）。
 * PKCE S256 验证。
 *
 * Controller 职责：编排（Zod 校验 → Drizzle 查询 → 领域函数校验 → 签发 Token → JSON 响应）
 *
 * @route POST /api/auth/oauth2/token
 * @impl H-AUTH-003 — OAuth 2.1 授权码流程
 * @impl H-AUTH-004 — 令牌安全交换（PKCE S256）
 * @impl H-AUTH-011 — PKCE code_verifier 验证
 */
import { type NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, and, gt } from 'drizzle-orm';
import { signAccessToken, signIdToken, issueRefreshToken, rotateRefreshToken, revokeRefreshTokenFamily, ACCESS_TOKEN_TTL } from '@/lib/auth/token';
import { validateClientActive, validateClientSecret } from '@/domain/auth/oauth-client';
import { verifyPKCE } from '@/domain/auth/oauth-code';
import { parseScopes } from '@/domain/auth/oauth-authorize';
import { getUserPermissionContext, cacheUserPermissionContext } from '@/lib/permissions';
import { mapToOAuthError } from '@/domain/shared/error-mapping';
import { mapServerError } from '@/lib/server-error';
import { InvalidGrantError } from '@/domain/shared/errors';

import { z } from 'zod';
import { OAUTH_PARAMS } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { parseOAuthBody } from '@/lib/auth/oauth-body';
import { resolveClientCredentials } from '@/lib/auth/client-credentials';


const TokenSchema = z.object({
  grant_type: z.enum([OAUTH_PARAMS.GRANT_TYPE_AUTHORIZATION_CODE, OAUTH_PARAMS.GRANT_TYPE_REFRESH_TOKEN]),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  // client_id/client_secret 可经 Basic 头传入（client_secret_basic），body 字段放宽为可选，
  // 由 resolveClientCredentials 统一裁决双通道（RFC 6749 §2.3.1）
  client_id: z.string().min(1).optional(),
  client_secret: z.string().optional(),
}).superRefine((data, ctx) => {
  // RFC 6749 §4.1.3：authorize 端点强制携带 redirect_uri，token 端点此时必须 REQUIRED
  if (data.grant_type === OAUTH_PARAMS.GRANT_TYPE_AUTHORIZATION_CODE && !data.redirect_uri) {
    ctx.addIssue({ code: 'custom', path: ['redirect_uri'], message: 'authorization_code 授权必须携带 redirect_uri' });
  }
});

export async function POST(request: NextRequest) {
  try {
    // 1. Zod 门禁（兼容 JSON 与 form-urlencoded，RFC 6749 §2.3）
    const body = await parseOAuthBody(request);
    const parsed = TokenSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    const { grant_type, code, redirect_uri, code_verifier, refresh_token } = parsed.data;

    // 2. 校验 Client（凭证双通道：client_secret_basic / client_secret_post，RFC 6749 §2.3.1）
    const creds = resolveClientCredentials(request, body);
    const clientRows = await db.select().from(schema.clients).where(eq(schema.clients.clientId, creds.clientId)).limit(1);
    validateClientActive(clientRows[0]);
    const client = clientRows[0]!;
    await validateClientSecret(client, creds.clientSecret);

    // ── grant_type: authorization_code ──
    if (grant_type === OAUTH_PARAMS.GRANT_TYPE_AUTHORIZATION_CODE) {
      if (!code || !code_verifier) {
        return NextResponse.json({ error: 'invalid_request', error_description: '缺少 code 或 code_verifier' }, { status: 400 });
      }

      // 原子领取授权码：并发请求中仅一个请求能从 used=false 更新为 used=true。
      // PKCE 失败后的 code 同样保持已消费，避免离线穷举 verifier。
      const [authCode] = await db
        .update(schema.authorizationCodes)
        .set({ used: true })
        .where(and(
          eq(schema.authorizationCodes.code, code),
          eq(schema.authorizationCodes.clientId, client.clientId),
          eq(schema.authorizationCodes.used, false),
          gt(schema.authorizationCodes.expiresAt, new Date()),
        ))
        .returning();
      if (!authCode || authCode.redirectUri !== redirect_uri) {
        // RFC 9700 §4.2.4：已消费授权码被再次兑换 = 疑似泄露，撤销该授权家族的 RT。
        // 仅锚定真实存在且已消费的 code 行（client 维度隔离）——普通坏 code / 过期 code
        // 不触发撤销，防止借随机 code 撤销他人家族（DoS 放大）。
        if (!authCode) {
          const [replayed] = await db
            .select()
            .from(schema.authorizationCodes)
            .where(and(
              eq(schema.authorizationCodes.code, code!),
              eq(schema.authorizationCodes.clientId, client.clientId),
              eq(schema.authorizationCodes.used, true),
            ))
            .limit(1);
          if (replayed) {
            await revokeRefreshTokenFamily(db, replayed.userId, replayed.clientId);
            writeLoginLog({ username: client.clientId, eventType: 'TOKEN_REFRESH_FAILED', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers), failReason: '授权码重放（已消费 code 二次兑换），已撤销同家族 Refresh Token' });
          }
        }
        throw new InvalidGrantError('授权码无效、已使用、已过期或 redirect_uri 不匹配');
      }

      // PKCE 验证（OAuth 2.1 强制要求：授权码必须携带 code_challenge）
      if (!authCode.codeChallenge || authCode.codeChallengeMethod !== 'S256') {
        throw new InvalidGrantError('授权码缺少 PKCE code_challenge');
      }
      await verifyPKCE(code_verifier!, authCode.codeChallenge);

      // 授权码已在上方原子领取时置 used=true，无需二次更新

      // 获取用户权限上下文并缓存到 Redis（通过中间层消除循环依赖）
      const permCtx = await getUserPermissionContext(authCode.userId);
      if (!permCtx) {
        throw new InvalidGrantError('无法获取用户权限上下文');
      }
      await cacheUserPermissionContext(authCode.userId, permCtx);

      // 签发 Access Token（aud/client_id = 授权对象 client，ADR-013）
      const { token: accessToken } = await signAccessToken(authCode.userId, client.clientId, authCode.scope);

      // 签发 Refresh Token（绑定发放 client，RFC 9700 token family）。
      // RT 按 offline_access 门控发放（OIDC Core §11：长期凭证仅在明确请求时发放，
      // 决策 D3）；Gateway 统一 OAuth Client 流程恒请求 offline_access，不受影响。
      const newRefreshToken = parseScopes(authCode.scope).includes('offline_access')
        ? await issueRefreshToken(authCode.userId, client.clientId, authCode.scope)
        : undefined;

      // ID Token（scope 包含 openid 时签发 OIDC 标准 ID Token）
      let idToken: string | undefined;
      if (parseScopes(authCode.scope).includes('openid')) {
        idToken = await signIdToken({
          userId: authCode.userId,
          clientId: client.clientId,
          nonce: authCode.nonce,
          authTime: authCode.createdAt,
        });
      }

      return NextResponse.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL,
        ...(newRefreshToken ? { refresh_token: newRefreshToken } : {}),
        id_token: idToken,
        scope: authCode.scope,
      });
    }

    // ── grant_type: refresh_token ──
    if (grant_type === OAUTH_PARAMS.GRANT_TYPE_REFRESH_TOKEN) {
      if (!refresh_token) {
        return NextResponse.json({ error: 'invalid_request', error_description: '缺少 refresh_token' }, { status: 400 });
      }

      // sender 绑定强制：RT 必须归属于当前认证的 client（RFC 9700 §4.14），
      // 不匹配视同泄露，家族撤销在 rotateRefreshToken 内原子完成
      const result = await rotateRefreshToken(refresh_token, client.clientId);
      if (!result) {
        writeLoginLog({ username: client.clientId, eventType: 'TOKEN_REFRESH_FAILED', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers), failReason: 'Refresh Token 无效或已过期' });
        // 注：username 填入 client_id 是因为 TOKEN 端点由 OAuth Client 调用，无真实用户上下文
        throw new InvalidGrantError('Refresh Token 无效或已过期');
      }

      // 续签成功 → 记录 TOKEN_REFRESH 日志（I-LOG-003）
      writeLoginLog({ username: client.clientId, eventType: 'TOKEN_REFRESH', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers) });

      return NextResponse.json({
        access_token: result.accessToken,
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
      });
    }

    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  } catch (err) {
    const mapped = mapServerError(err);
    const oauthError = mapToOAuthError(mapped.error);

    return NextResponse.json(
      { error: oauthError, error_description: mapped.message },
      { status: mapped.status },
    );
  }
}
