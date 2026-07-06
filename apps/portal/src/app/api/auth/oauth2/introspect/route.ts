/**
 * Token Introspection 端点 (POST /api/auth/oauth2/introspect) — RFC 7662
 *
 * 供资源服务器校验 Access Token 或 Refresh Token 是否有效。
 *
 * @route POST /api/auth/oauth2/introspect
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/token';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { hashToken } from '@/lib/crypto';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { validateClientActive, validateClientSecret } from '@/domain/auth/oauth-client';


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = body.token as string | undefined;
    const clientId = body.client_id as string | undefined;
    const clientSecret = body.client_secret as string | undefined;

    // RFC 7662 §2.1：introspection 端点必须校验调用方身份（client credentials）
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

    if (!token) {
      return NextResponse.json({ active: false });
    }

    // 尝试作为 Access Token 验签
    const claims = await verifyAccessToken(token);
    if (claims) {
      return NextResponse.json({
        active: true,
        scope: claims.permissions?.join(' ') || '',
        client_id: (typeof claims.aud === 'string' ? claims.aud : claims.aud?.[0]) || '',
        sub: claims.sub,
        token_type: 'Bearer',
        exp: claims.exp,
        iat: claims.iat,
        iss: claims.iss,
        jti: claims.jti,
      });
    }

    // 尝试作为 Refresh Token 查询（tokenHash 存 SHA256，查询时需同样 hash）
    const rtRows = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, hashToken(token)))
      .limit(1);

    if (rtRows.length > 0) {
      const rt = rtRows[0]!;
      const isRevoked = !!rt.revoked;
      const isExpired = rt.expiresAt ? new Date(rt.expiresAt) < new Date() : false;

      return NextResponse.json({
        active: !isRevoked && !isExpired,
        scope: rt.scopes,
        client_id: rt.clientId,
        sub: rt.userId,
        token_type: 'refresh_token',
      });
    }

    return NextResponse.json({ active: false });
  } catch (err) {
    // RFC 7662: 异常时仍返回 { active: false }，但统一日志输出
    mapDomainError(err);
    return NextResponse.json({ active: false });
  }
}
