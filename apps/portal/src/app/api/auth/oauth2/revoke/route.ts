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
import { hashToken } from '@/lib/crypto';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { validateClientActive, validateClientSecret } from '@/domain/auth/oauth-client';


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = body.token as string | undefined;
    const tokenTypeHint = body.token_type_hint as string | undefined;
    const clientId = body.client_id as string | undefined;
    const clientSecret = body.client_secret as string | undefined;

    // RFC 7009 §2.1：revocation 端点必须校验调用方身份，防止恶意撤销他人令牌（DoS）
    if (!clientId) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: '缺少 client_id' },
        { status: 401 },
      );
    }
    const clientRows = await db.select().from(schema.clients).where(eq(schema.clients.clientId, clientId)).limit(1);
    try {
      validateClientActive(clientRows[0]);
      validateClientSecret(clientRows[0]!, clientSecret);
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

    // 尝试撤销 Access Token（jti 黑名单 + 删 access_tokens 行）
    if (!tokenTypeHint || tokenTypeHint === 'access_token') {
      const claims = await verifyAccessToken(token);
      if (claims?.jti && claims.exp) {
        await revokeJti(claims.jti, claims.exp);
      }
      // claims 存在即为有效 access token，同步删除其入库行（UI 列表一致性）
      if (claims) {
        try {
          await db.delete(schema.accessTokens).where(eq(schema.accessTokens.tokenHash, hashToken(token)));
        } catch (e) {
          console.error('[Revoke] 删除 access_tokens 失败:', e);
        }
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
