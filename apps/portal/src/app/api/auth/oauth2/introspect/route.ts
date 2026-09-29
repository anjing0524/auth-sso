/**
 * Token Introspection 端点 (POST /api/auth/oauth2/introspect) — RFC 7662
 *
 * 供资源服务器校验 Access Token 或 Refresh Token 是否有效。
 *
 * @route POST /api/auth/oauth2/introspect
 */
import { type NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/token';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { hashToken } from '@/lib/crypto';
import { mapServerError } from '@/lib/server-error';
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

    // 尝试作为 Access Token 验签（无状态：签名 + exp + issuer + jti 黑名单。
    // verifyAccessToken 内部已完成黑名单复核，active:true 即未被撤销）
    const claims = await verifyAccessToken(token);
    if (claims) {
      // RFC 7662 §2.2：除 active 外全部字段可选。AT 经 ADR-006 最小化后不含
      // scope/client_id 语义，诚实省略而非返回空串误导 RS；scope 语义由 RT 分支提供。
      return NextResponse.json({
        active: true,
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
    const mapped = mapServerError(err);
    log.error('Exception', { error: mapped.error, message: mapped.message });
    return NextResponse.json({ active: false });
  }
}
