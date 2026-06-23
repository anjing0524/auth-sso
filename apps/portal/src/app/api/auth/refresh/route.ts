/**
 * Token 刷新 API (POST /api/auth/refresh)
 *
 * Refresh Token Rotation：消耗旧 RT，签发新 AT + RT。
 *
 * @route POST /api/auth/refresh
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRefreshTokenFromCookie } from '@/lib/session';
import { rotateRefreshToken } from '@/lib/auth/token';
import { COOKIE_NAMES, TOKEN_TTL } from '@auth-sso/contracts';


export async function POST(request: NextRequest) {
  try {
    const refreshToken = await getRefreshTokenFromCookie();
    if (!refreshToken) {
      return NextResponse.json(
        { success: false, error: 'REFRESH_TOKEN_MISSING', message: '缺少 Refresh Token' },
        { status: 401 },
      );
    }

    const result = await rotateRefreshToken(refreshToken, 'portal');
    if (!result) {
      const response = NextResponse.json(
        { success: false, error: 'REFRESH_TOKEN_INVALID', message: 'Refresh Token 无效或已过期' },
        { status: 401 },
      );
      // 清除无效 Cookie
      response.cookies.set(COOKIE_NAMES.JWT, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
      response.cookies.set(COOKIE_NAMES.REFRESH, '', { path: '/api/auth/refresh', httpOnly: true, sameSite: 'lax', maxAge: 0 });
      return response;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const response = NextResponse.json({ success: true, data: { expiresIn: result.expiresIn } });

    response.cookies.set(COOKIE_NAMES.JWT, result.accessToken, {
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: result.expiresIn,
    });

    response.cookies.set(COOKIE_NAMES.REFRESH, result.refreshToken, {
      path: '/api/auth/refresh',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: TOKEN_TTL.REFRESH_TOKEN,
    });

    return response;
  } catch (err) {
    console.error('[Refresh API] 刷新失败:', err);
    return NextResponse.json(
      { success: false, error: 'INTERNAL_ERROR', message: 'Token 刷新失败' },
      { status: 500 },
    );
  }
}
