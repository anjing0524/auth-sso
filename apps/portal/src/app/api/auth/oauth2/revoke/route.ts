/**
 * Token Revocation 端点 (POST /api/auth/oauth2/revoke) — RFC 7009
 *
 * 撤销 Access Token（jti 黑名单）或 Refresh Token（DB revoked 标记）。
 *
 * @route POST /api/auth/oauth2/revoke
 */
import { type NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/token';
import { revokeJti } from '@/lib/session/revoke';
import { db, schema } from '@/infrastructure/db';
import { eq, and } from 'drizzle-orm';
import { hashToken } from '@/lib/crypto';
import { mapServerError } from '@/lib/server-error';
import { parseOAuthBody } from '@/lib/auth/oauth-body';
import { authenticateOAuthClient } from '@/lib/auth/oauth-helpers';
import { resolveClientCredentials, type ClientCredentials } from '@/lib/auth/client-credentials';
import { createLogger } from '@/lib/logger';
import { JWT_TYP } from '@auth-sso/contracts';

const log = createLogger('Revoke');


export async function POST(request: NextRequest) {
  try {
    const body = await parseOAuthBody(request);
    const token = body.token;
    const tokenTypeHint = body.token_type_hint;

    // RFC 7009 §2.1：revocation 端点必须校验调用方身份，防止恶意撤销他人令牌（DoS）。
    // 凭证支持 Basic / post 双通道（RFC 6749 §2.3.1）。
    let creds: ClientCredentials;
    try {
      creds = resolveClientCredentials(request, body);
      await authenticateOAuthClient(creds.clientId, creds.clientSecret);
    } catch {
      return NextResponse.json(
        { error: 'invalid_client', error_description: '客户端凭证无效' },
        { status: 401 },
      );
    }

    // RFC 7009: 即使 token 不存在也返回 200
    if (!token) {
      return NextResponse.json({});
    }

    // 尝试撤销 Access Token（jti 黑名单 — AT 无持久化行，黑名单是唯一撤销通道）。
    // RFC 7009 §2.1：仅撤销归属当前认证 client 的 token（client_id claim，ADR-013）；
    // 他人 token 一律静默忽略——与 RT 分支的 client 限定共同阻断跨 client 撤销 DoS。
    // audience 传 null：多 client 通用端点，归属由 client_id claim 判定而非 aud。
    if (!tokenTypeHint || tokenTypeHint === 'access_token') {
      const claims = await verifyAccessToken(token, null, JWT_TYP.ACCESS_TOKEN);
      if (claims?.jti && claims.exp && claims.client_id === creds.clientId) {
        await revokeJti(claims.jti, claims.exp);
      }
    }

    // 尝试撤销 Refresh Token（DB revoked 标记，限定当前认证 client 名下的行）
    if (!tokenTypeHint || tokenTypeHint === 'refresh_token') {
      await db
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        // tokenHash 存储的是 SHA256(token)，查询时需同样 hash 匹配
        .where(and(
          eq(schema.refreshTokens.tokenHash, hashToken(token)),
          eq(schema.refreshTokens.clientId, creds.clientId),
        ));
    }

    // RFC 7009 §2.2: 撤销成功（或 token 不存在）时均返回 HTTP 200
    return NextResponse.json({});

  } catch (err) {
    // RFC 7009: 异常时仍返回 200，结构化日志记录不含堆栈（防信息泄露）
    const mapped = mapServerError(err);
    log.error('Exception', { error: mapped.error, message: mapped.message });
    return NextResponse.json({});
  }
}
