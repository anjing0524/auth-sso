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
import { parseOAuthBody } from '@/lib/auth/oauth-body';


export async function POST(request: NextRequest) {
  try {
    const body = await parseOAuthBody(request);
    const token = body.token;
    const tokenTypeHint = body.token_type_hint;
    const clientId = body.client_id;
    const clientSecret = body.client_secret;

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
        // tokenHash 存储的是 SHA256(token)，查询时需同样 hash 匹配
        .where(eq(schema.refreshTokens.tokenHash, hashToken(token)));
    }

  } catch (err) {
    // RFC 7009: 异常时仍返回 200，但进行日志输出，避免堆栈丢失
    const mapped = mapDomainError(err);
    console.error('[OAuth2 Revoke] Exception details:', {
      error: mapped.error,
      message: mapped.message,
      stack: err instanceof Error ? err.stack : String(err),
    });
    return NextResponse.json({});
  }
}
