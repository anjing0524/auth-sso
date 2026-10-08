/**
 * OAuth 2.1 Token 端点 (POST /api/auth/oauth2/token)
 *
 * 支持 grant_type: authorization_code（code 换 token）和 refresh_token（轮换）。
 *
 * Controller 职责：协议适配（Zod 门禁 → 凭证认证 → 分派 grant → 写响应）。
 * 两种 grant 的**编排本身**在深 module 中：
 * - authorization_code → `lib/auth/oauth-grant.ts`（原子领取 + PKCE + 签发）
 * - refresh_token      → `lib/auth/token.ts` 的 `rotateRefreshToken`
 * 本文件不再内联 SQL 与签发序列。
 *
 * @route POST /api/auth/oauth2/token
 * @impl H-AUTH-003 — OAuth 2.1 授权码流程
 * @impl H-AUTH-004 — 令牌安全交换（PKCE S256）
 * @impl H-AUTH-011 — PKCE code_verifier 验证
 */
import { type NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { rotateRefreshToken } from '@/lib/auth/token';
import { exchangeAuthorizationCode } from '@/lib/auth/oauth-grant';
import { validateClientActive, validateClientSecret } from '@/domain/auth/oauth-client';
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

      const outcome = await exchangeAuthorizationCode({
        code,
        client,
        redirectUri: redirect_uri!,
        codeVerifier: code_verifier,
      });

      if (!outcome.ok) {
        if (outcome.reason === 'authorization_code_replayed') {
          // 重放 = 疑似泄露（RFC 9700 §4.2.4）。家族撤销已在 module 内完成，
          // 此处只负责留审计痕迹并统一响应形状。
          writeLoginLog({
            username: client.clientId,
            eventType: 'TOKEN_REFRESH_FAILED',
            ip: extractClientIP(request.headers),
            userAgent: extractUserAgent(request.headers),
            failReason: '授权码重放（已消费 code 二次兑换），已撤销同家族 Refresh Token',
          });
          throw new InvalidGrantError('授权码无效、已使用、已过期或 redirect_uri 不匹配');
        }
        throw new InvalidGrantError(outcome.detail);
      }

      return NextResponse.json(outcome.tokens);
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
