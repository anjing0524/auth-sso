/**
 * OIDC UserInfo 端点 (GET /api/auth/oauth2/userinfo)
 *
 * 返回当前 Access Token 对应的用户信息。
 * 从 Authorization: Bearer <token> Header 或 portal_jwt_token Cookie 中获取 Token。
 *
 * @route GET /api/auth/oauth2/userinfo
 */
import { type NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/token';
import { getJwtFromCookie } from '@/lib/session';
import { mapServerError } from '@/lib/server-error';
import { getUserProfile } from '@/app/(dashboard)/users/data';
import { parseScopes } from '@/domain/auth/oauth-authorize';
import { JWT_TYP } from '@auth-sso/contracts';

/** RFC 6750 §3：401 响应 MUST 携带 WWW-Authenticate；无效凭证 SHOULD 带 error 属性 */
const WWW_AUTHENTICATE_BEARER = 'Bearer';
const WWW_AUTHENTICATE_INVALID_TOKEN = 'Bearer error="invalid_token"';

export async function GET(request: NextRequest) {
  try {
    // 从 Authorization Header 或 Cookie 获取 token（Cookie 回退为门户自用的
    // 非标准扩展：浏览器页面直连 userinfo 免重复传头，文档化于研究笔记 §5）
    const authHeader = request.headers.get('authorization');
    const token: string | null = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : await getJwtFromCookie();

    if (!token) {
      return NextResponse.json(
        { error: 'invalid_token' },
        { status: 401, headers: { 'WWW-Authenticate': WWW_AUTHENTICATE_BEARER } },
      );
    }

    const claims = await verifyAccessToken(token, null, JWT_TYP.ACCESS_TOKEN); // UserInfo 不校验 audience（多 client 通用端点）
    if (!claims) {
      return NextResponse.json(
        { error: 'invalid_token' },
        { status: 401, headers: { 'WWW-Authenticate': WWW_AUTHENTICATE_INVALID_TOKEN } },
      );
    }

    // 查询用户档案（委托 data 层，仅取 OIDC 标准字段，不做角色/部门 JOIN）
    const user = await getUserProfile(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: 'invalid_token' },
        { status: 401, headers: { 'WWW-Authenticate': WWW_AUTHENTICATE_INVALID_TOKEN } },
      );
    }

    const scopes = new Set(parseScopes(claims.scope ?? ''));
    const response: Record<string, string | boolean | null> = { sub: user.id };
    if (scopes.has('profile')) {
      response.name = user.name;
      response.preferred_username = user.username;
      response.picture = user.avatarUrl;
    }
    if (scopes.has('email')) {
      response.email = user.email;
      response.email_verified = user.emailVerified;
    }
    return NextResponse.json(response);
  } catch (err) {
    const mapped = mapServerError(err);
    // RFC 6750 §3：错误体只认 OAuth 错误名（invalid_request / invalid_token /
    // insufficient_scope …），且 401 MUST 携带 WWW-Authenticate。
    // 此前这里回的是**内部码**（AUTH_SSO_xxxx）——OIDC 客户端无从识别（巡检候选 4 实测）。
    if (mapped.status >= 500) {
      // 服务器出错不是"令牌无效"：保留状态码，用 OAuth 的 server_error
      return NextResponse.json({ error: 'server_error' }, { status: mapped.status });
    }
    const oauthError =
      mapped.status === 400 ? 'invalid_request' : mapped.status === 403 ? 'insufficient_scope' : 'invalid_token';
    return NextResponse.json(
      { error: oauthError },
      { status: mapped.status, headers: { 'WWW-Authenticate': `Bearer error="${oauthError}"` } },
    );
  }
}
