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
import { and, eq } from 'drizzle-orm';
import { hashToken } from '@/lib/crypto';
import { mapServerError } from '@/lib/server-error';
import { parseOAuthBody } from '@/lib/auth/oauth-body';
import { authenticateOAuthClient, withOAuthNoStore } from '@/lib/auth/oauth-helpers';
import { resolveClientCredentials, type ClientCredentials } from '@/lib/auth/client-credentials';
import { createLogger } from '@/lib/logger';
import { JWT_TYP } from '@auth-sso/contracts';

const log = createLogger('Introspect');


export async function POST(request: NextRequest) {
  try {
    const body = await parseOAuthBody(request);
    const token = body.token;

    // RFC 7662 §2.1：introspection 端点必须校验调用方身份（client credentials，
    // Basic / post 双通道，RFC 6749 §2.3.1）
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

    if (!token) {
      return withOAuthNoStore(NextResponse.json({ active: false }));
    }

    // 尝试作为 Access Token 验签（无状态：签名 + exp + issuer + jti 黑名单。
    // verifyAccessToken 内部已完成黑名单复核，active:true 即未被撤销。
    // audience 传 null：多 client 通用端点，aud 由 RS 按 RFC 7662 响应自行判定）
    const claims = await verifyAccessToken(token, null, JWT_TYP.ACCESS_TOKEN);
    // H-07：只向**签发该令牌的 client** 披露内省元数据（RFC 7662 §2.1 端点保护策略）。
    // 其他 client 一律按"不可识别"返回 inactive——与未知 token 同形，防跨租户元数据泄露。
    if (claims && claims.client_id === creds.clientId) {
      // RFC 7662 §2.2：除 active 外全部字段可选。AT 显式携带 OAuth 协议数据
      // （aud = client_id + client_id claim + scope，ADR-013），透传给 RS 供
      // 授权判定与审计；其余仅返回真实存在的字段。
      return withOAuthNoStore(NextResponse.json({
        active: true,
        sub: claims.sub,
        ...(claims.scope ? { scope: claims.scope } : {}),
        ...(claims.client_id ? { client_id: claims.client_id, aud: claims.aud } : {}),
        token_type: 'Bearer',
        exp: claims.exp,
        iat: claims.iat,
        iss: claims.iss,
        jti: claims.jti,
      }));
    }

    // 尝试作为 Refresh Token 查询（tokenHash 存 SHA256，查询时需同样 hash）。
    // H-07：同时限定 client 归属，杜绝 client B 内省 client A 的 RT 元数据。
    const rtRows = await db
      .select()
      .from(schema.refreshTokens)
      .where(and(
        eq(schema.refreshTokens.tokenHash, hashToken(token)),
        eq(schema.refreshTokens.clientId, creds.clientId),
      ))
      .limit(1);

    if (rtRows.length > 0) {
      const rt = rtRows[0]!;
      const isRevoked = !!rt.revoked;
      const isExpired = rt.expiresAt ? new Date(rt.expiresAt) < new Date() : false;

      return withOAuthNoStore(NextResponse.json({
        active: !isRevoked && !isExpired,
        scope: rt.scopes,
        client_id: rt.clientId,
        sub: rt.userId,
        token_type: 'refresh_token',
      }));
    }

    // RFC 7662 §2.2: token 不可识别时返回 { active: false }，不得返回错误
    return withOAuthNoStore(NextResponse.json({ active: false }));

  } catch (err) {
    // RFC 7662: 异常时仍返回 { active: false }，结构化日志记录不含堆栈（防信息泄露）
    const mapped = mapServerError(err);
    log.error('Exception', { error: mapped.error, message: mapped.message });
    return withOAuthNoStore(NextResponse.json({ active: false }));
  }
}
