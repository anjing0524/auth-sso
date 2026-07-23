/**
 * OAuth 2.1 Token 端点 (POST /api/auth/oauth2/token)
 *
 * 支持 grant_type: authorization_code（code 换 token）和 refresh_token（轮换）。
 * PKCE S256 验证。
 *
 * Controller 职责：编排（Zod 校验 → Drizzle 查询 → 领域函数校验 → 签发 Token → JSON 响应）
 *
 * @route POST /api/auth/oauth2/token
 */
import { type NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, and } from 'drizzle-orm';
import { signAccessToken, signIdToken, issueRefreshToken, rotateRefreshToken, ACCESS_TOKEN_TTL } from '@/lib/auth/token';
import { validateClientActive, validateClientSecret } from '@/domain/auth/oauth-client';
import { validateAuthCodeRow, verifyPKCE } from '@/domain/auth/oauth-code';
import { getUserPermissionContext, cacheUserPermissionContext } from '@/lib/permissions';
import { mapDomainError, mapToOAuthError } from '@/domain/shared/error-mapping';
import { InvalidGrantError } from '@/domain/shared/errors';

import { z } from 'zod';
import { OAUTH_PARAMS } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { parseOAuthBody } from '@/lib/auth/oauth-body';


const TokenSchema = z.object({
  grant_type: z.enum([OAUTH_PARAMS.GRANT_TYPE_AUTHORIZATION_CODE, OAUTH_PARAMS.GRANT_TYPE_REFRESH_TOKEN]),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
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

    const { grant_type, client_id, client_secret, code, redirect_uri, code_verifier, refresh_token } = parsed.data;

    // 2. 校验 Client
    const clientRows = await db.select().from(schema.clients).where(eq(schema.clients.clientId, client_id)).limit(1);
    validateClientActive(clientRows[0]);
    const client = clientRows[0]!;
    await validateClientSecret(client, client_secret);

    // ── grant_type: authorization_code ──
    if (grant_type === OAUTH_PARAMS.GRANT_TYPE_AUTHORIZATION_CODE) {
      if (!code || !code_verifier) {
        return NextResponse.json({ error: 'invalid_request', error_description: '缺少 code 或 code_verifier' }, { status: 400 });
      }

      // 查找并校验授权码
      const codeRows = await db
        .select()
        .from(schema.authorizationCodes)
        .where(and(eq(schema.authorizationCodes.code, code), eq(schema.authorizationCodes.clientId, client.clientId)))
        .limit(1);

      validateAuthCodeRow(codeRows[0], redirect_uri);
      const authCode = codeRows[0]!;

      // PKCE 验证（OAuth 2.1 强制要求：授权码必须携带 code_challenge）
      if (!authCode.codeChallenge || authCode.codeChallengeMethod !== 'S256') {
        throw new InvalidGrantError('授权码缺少 PKCE code_challenge');
      }
      await verifyPKCE(code_verifier!, authCode.codeChallenge);

      // 标记授权码已使用
      await db.update(schema.authorizationCodes).set({ used: true }).where(eq(schema.authorizationCodes.id, authCode.id));

      // 获取用户权限上下文并缓存到 Redis（通过中间层消除循环依赖）
      const permCtx = await getUserPermissionContext(authCode.userId);
      if (!permCtx) {
        throw new InvalidGrantError('无法获取用户权限上下文');
      }
      await cacheUserPermissionContext(authCode.userId, permCtx);

      // 签发 Access Token
      const { token: accessToken } = await signAccessToken(authCode.userId);

      // 签发 Refresh Token
      const newRefreshToken = await issueRefreshToken(authCode.userId, authCode.scope);

      // ID Token（scope 包含 openid 时签发 OIDC 标准 ID Token）
      let idToken: string | undefined;
      if (authCode.scope.includes('openid')) {
        idToken = await signIdToken({
          userId: authCode.userId,
          clientId: client_id,
          nonce: authCode.nonce,
          authTime: authCode.createdAt,
        });
      }

      return NextResponse.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL,
        refresh_token: newRefreshToken,
        id_token: idToken,
        scope: authCode.scope,
      });
    }

    // ── grant_type: refresh_token ──
    if (grant_type === OAUTH_PARAMS.GRANT_TYPE_REFRESH_TOKEN) {
      if (!refresh_token) {
        return NextResponse.json({ error: 'invalid_request', error_description: '缺少 refresh_token' }, { status: 400 });
      }

      const result = await rotateRefreshToken(refresh_token);
      if (!result) {
        writeLoginLog({ username: client_id, eventType: 'TOKEN_REFRESH_FAILED', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers), failReason: 'Refresh Token 无效或已过期' });
        // 注：username 填入 client_id 是因为 TOKEN 端点由 OAuth Client 调用，无真实用户上下文
        throw new InvalidGrantError('Refresh Token 无效或已过期');
      }

      // 续签成功 → 记录 TOKEN_REFRESH 日志（I-LOG-003）
      writeLoginLog({ username: client_id, eventType: 'TOKEN_REFRESH', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers) });

      return NextResponse.json({
        access_token: result.accessToken,
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
      });
    }

    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  } catch (err) {
    const mapped = mapDomainError(err);
    const oauthError = mapToOAuthError(mapped.error);

    return NextResponse.json(
      { error: oauthError, error_description: mapped.message },
      { status: mapped.status },
    );
  }
}
