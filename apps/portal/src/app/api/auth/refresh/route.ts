/**
 * Token 刷新 API (POST /api/auth/refresh)
 *
 * Refresh Token Rotation：消耗旧 RT，签发新 AT + RT。
 *
 * @route POST /api/auth/refresh
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRefreshTokenFromCookie } from '@/lib/session';
import { rotateRefreshToken } from '@/domain/auth/token';

export const runtime = 'nodejs';

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
      response.cookies.set('portal_jwt_token', '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
      response.cookies.set('portal_refresh_token', '', { path: '/api/auth/refresh', httpOnly: true, sameSite: 'lax', maxAge: 0 });
      return response;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const response = NextResponse.json({ success: true, data: { expiresIn: result.expiresIn } });

    response.cookies.set('portal_jwt_token', result.accessToken, {
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: result.expiresIn,
    });

    response.cookies.set('portal_refresh_token', result.refreshToken, {
      path: '/api/auth/refresh',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 3600,
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
