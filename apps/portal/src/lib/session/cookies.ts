import 'server-only';

/**
 * JWT Cookie 读写工具（服务端调用）
 *
 * @module lib/session/cookies
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { JWT_COOKIE_NAME, REFRESH_COOKIE_NAME } from './types';

/**
 * 将 Access Token 和 Refresh Token 分别写入 HttpOnly Cookie
 * 在 OIDC 回调成功后由 Portal BFF 调用
 */
export function setJwtCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string | undefined,
  accessTokenExpiresIn: number = 3600
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  response.cookies.set(JWT_COOKIE_NAME, accessToken, {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: accessTokenExpiresIn,
  });

  if (refreshToken) {
    response.cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
      path: '/api/auth/refresh',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
    });
  }
}

/**
 * 清除 Access Token 和 Refresh Token Cookie（登出时调用）
 */
export function clearJwtCookies(response: Response): void {
  const expiredCookieBase = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  response.headers.append('Set-Cookie', `${JWT_COOKIE_NAME}=; ${expiredCookieBase}`);
  response.headers.append(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=; Path=/api/auth/refresh; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

/**
 * 从当前请求的 Cookie 中读取 Access Token 字符串
 */
export async function getJwtFromCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(JWT_COOKIE_NAME)?.value ?? null;
  } catch (error) {
    console.error('[Session] Failed to read JWT cookie:', error);
    return null;
  }
}

/**
 * 从当前请求的 Cookie 中读取 Refresh Token 字符串
 */
export async function getRefreshTokenFromCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(REFRESH_COOKIE_NAME)?.value ?? null;
  } catch (error) {
    console.error('[Session] Failed to read refresh token cookie:', error);
    return null;
  }
}
