/**
 * 登出 API (POST /api/auth/logout)
 *
 * jti 黑名单撤销 + Cookie 清除。
 * Auth Proof Token 中没有 refresh token，只需撤销 jti。
 *
 * @route POST /api/auth/logout
 */
import { NextResponse } from 'next/server';
import { getJwtFromCookie } from '@/lib/session';
import { revokeJti } from '@/lib/session/revoke';
import { verifyAccessToken } from '@/lib/auth/token';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const token = await getJwtFromCookie();
    if (token) {
      const claims = await verifyAccessToken(token);
      if (claims?.jti && claims.exp) {
        await revokeJti(claims.jti, claims.exp);
      }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set('portal_jwt_token', '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
    return response;
  } catch (err) {
    console.error('[Logout API] 登出异常:', err);
    const response = NextResponse.json({ success: true });
    response.cookies.set('portal_jwt_token', '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
    return response;
  }
}
