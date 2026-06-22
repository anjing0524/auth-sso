/**
 * Token Revocation 端点 (POST /api/auth/oauth2/revoke) — RFC 7009
 *
 * 撤销 Access Token（jti 黑名单）或 Refresh Token（DB revoked 标记）。
 *
 * @route POST /api/auth/oauth2/revoke
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/token';
import { revokeJti } from '@/lib/session/revoke';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { mapDomainError } from '@/domain/shared/error-mapping';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = body.token as string | undefined;
    const tokenTypeHint = body.token_type_hint as string | undefined;

    // RFC 7009: 即使 token 不存在也返回 200
    if (!token) {
      return NextResponse.json({});
    }

    // 尝试撤销 Access Token（jti 黑名单）
    if (!tokenTypeHint || tokenTypeHint === 'access_token') {
      const claims = await verifyAccessToken(token);
      if (claims?.jti && claims.exp) {
        await revokeJti(claims.jti, claims.exp);
      }
    }

    // 尝试撤销 Refresh Token（DB revoked 标记）
    if (!tokenTypeHint || tokenTypeHint === 'refresh_token') {
      await db
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        .where(eq(schema.refreshTokens.tokenHash, token));
    }

    // RFC 7009: 始终返回 200
    return NextResponse.json({});
  } catch (err) {
    // RFC 7009: 异常时仍返回 200，但统一日志输出
    mapDomainError(err);
    return NextResponse.json({});
  }
}
