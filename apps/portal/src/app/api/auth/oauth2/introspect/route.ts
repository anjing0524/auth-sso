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
import { parseOAuthBody } from '@/lib/auth/oauth-body';
import { authenticateOAuthClient } from '@/lib/auth/oauth-helpers';
import { createLogger } from '@/lib/logger';

const log = createLogger('Introspect');


export async function POST(request: NextRequest) {
  try {
    const body = await parseOAuthBody(request);
    const token = body.token;
    const clientId = body.client_id;
    const clientSecret = body.client_secret;

    // RFC 7662 §2.1：introspection 端点必须校验调用方身份（client credentials）
    if (!clientId) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: '缺少 client_id' },
        { status: 401 },
      );
    }
    try {
      await authenticateOAuthClient(clientId, clientSecret);
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
      // client_id / scope 取自 access_tokens DB 行（签发时持久化），而非 JWT claims（aud 语义 ≠ client_id）
      const atRows = await db
        .select({ clientId: schema.accessTokens.clientId, scopes: schema.accessTokens.scopes })
        .from(schema.accessTokens)
        .where(eq(schema.accessTokens.tokenHash, hashToken(token)))
        .limit(1);
      const atRow = atRows[0];
      return NextResponse.json({
        active: true,
        scope: atRow?.scopes || '',
        client_id: atRow?.clientId || '',
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

    // RFC 7662 §2.2: token 不可识别时返回 { active: false }，不得返回错误
    return NextResponse.json({ active: false });

  } catch (err) {
    // RFC 7662: 异常时仍返回 { active: false }，结构化日志记录不含堆栈（防信息泄露）
    const mapped = mapDomainError(err);
    log.error('Exception', { error: mapped.error, message: mapped.message });
    return NextResponse.json({ active: false });
  }
}
