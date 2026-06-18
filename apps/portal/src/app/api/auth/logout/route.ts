/**
 * 登出 API (POST /api/auth/logout)
 *
 * jti 黑名单撤销 + Cookie 清除。
 * 同时撤销 portal_jwt_token（Access Token）和 login_session（Login Session Token）的 jti，
 * 确保两种 Cookie 路径下的凭证都被主动失效。
 *
 * @route POST /api/auth/logout
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { revokeJti } from '@/lib/session/revoke';
import { verifyAccessToken } from '@/lib/auth/token';
import { decodeJwtPayload } from '@/lib/session/jwt';
import { COOKIE_NAMES } from '@auth-sso/contracts';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const cookieStore = await cookies();

    // 撤销 portal_jwt_token 的 jti（Access Token）
    const jwtToken = cookieStore.get(COOKIE_NAMES.JWT)?.value;
    if (jwtToken) {
      const claims = await verifyAccessToken(jwtToken);
      if (claims?.jti && claims.exp) {
        await revokeJti(claims.jti, claims.exp);
      }
    }

    // 撤销 login_session 的 jti（Login Session Token，5min TTL 的一次性凭证）
    const loginSession = cookieStore.get(COOKIE_NAMES.LOGIN_SESSION)?.value;
    if (loginSession) {
      const payload = decodeJwtPayload(loginSession);
      if (payload?.jti && payload.exp) {
        await revokeJti(payload.jti, payload.exp);
      }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(COOKIE_NAMES.JWT, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
    response.cookies.set(COOKIE_NAMES.LOGIN_SESSION, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
    return response;
  } catch (err) {
    console.error('[Logout API] 登出异常:', err);
    const response = NextResponse.json({ success: true });
    response.cookies.set(COOKIE_NAMES.JWT, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
    response.cookies.set(COOKIE_NAMES.LOGIN_SESSION, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
    return response;
  }
}
