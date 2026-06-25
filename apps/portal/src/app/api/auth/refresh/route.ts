/**
 * Token 刷新 API (POST /)
 *
 * Refresh Token Rotation：消耗旧 RT，签发新 AT + RT。
 *
 * 优化：如果当前 Access Token 剩余时间 > 5 分钟，跳过刷新（避免无效的 token 轮换）。
 *
 * @route POST /
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRefreshTokenFromCookie, getJwtFromCookie, decodeJwtPayload } from '@/lib/session';
import { rotateRefreshToken } from '@/lib/auth/token';
import { COOKIE_NAMES, TOKEN_TTL } from '@auth-sso/contracts';

/** 刷新阈值（秒）：仅当 Access Token 剩余时间 < 此值时执行刷新 */
const REFRESH_THRESHOLD = 5 * 60; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const refreshToken = await getRefreshTokenFromCookie();
    if (!refreshToken) {
      return NextResponse.json(
        { success: false, error: 'REFRESH_TOKEN_MISSING', message: '缺少 Refresh Token' },
        { status: 401 },
      );
    }

    // 检查当前 Access Token 的剩余时间，避免不必要的 token 轮换（H-SESS-003）
    const accessToken = await getJwtFromCookie();
    if (accessToken) {
      const claims = decodeJwtPayload(accessToken);
      if (claims?.exp) {
        const remaining = claims.exp - Math.floor(Date.now() / 1000);
        if (remaining > REFRESH_THRESHOLD) {
          return NextResponse.json({ success: true, data: { skipped: true, remaining } });
        }
      }
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
    // 本地开发/E2E环境下，直连 HTTP 端口时必须降级为 secure: false，否则浏览器会拒绝写入
    const isLocal = request.headers.get('host')?.includes('localhost') || request.headers.get('host')?.includes('127.0.0.1');
    const secure = isProduction && !isLocal;
    const response = NextResponse.json({ success: true, data: { expiresIn: result.expiresIn } });

    response.cookies.set(COOKIE_NAMES.JWT, result.accessToken, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: result.expiresIn,
    });

    response.cookies.set(COOKIE_NAMES.REFRESH, result.refreshToken, {
      path: '/api/auth/refresh',
      httpOnly: true,
      secure,
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
