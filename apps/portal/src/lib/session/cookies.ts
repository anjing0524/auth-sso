import 'server-only';

/**
 * JWT Cookie 读写工具（服务端调用）
 *
 * @module lib/session/cookies
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import { TOKEN_TTL } from '@auth-sso/contracts';

/**
 * 将 Access Token 和 Refresh Token 分别写入 HttpOnly Cookie
 * 在 OIDC 回调成功后由 Portal BFF 调用
 */
export function setJwtCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string | undefined,
  accessTokenExpiresIn: number = TOKEN_TTL.ACCESS_TOKEN
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  response.cookies.set(COOKIE_NAMES.JWT, accessToken, {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: accessTokenExpiresIn,
  });

  if (refreshToken) {
    response.cookies.set(COOKIE_NAMES.REFRESH, refreshToken, {
      path: '/api/auth/refresh',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: TOKEN_TTL.REFRESH_TOKEN,
    });
  }
}

/**
 * 清除 Access Token 和 Refresh Token Cookie（登出时调用）
 */
export function clearJwtCookies(response: Response): void {
  const expiredCookieBase = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  response.headers.append('Set-Cookie', `${COOKIE_NAMES.JWT}=; ${expiredCookieBase}`);
  response.headers.append(
    'Set-Cookie',
    `${COOKIE_NAMES.REFRESH}=; Path=/api/auth/refresh; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

/**
 * 从当前请求的 Cookie 中读取 Access Token 字符串
 */
export async function getJwtFromCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get(COOKIE_NAMES.JWT)?.value ?? null;
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
    return cookieStore.get(COOKIE_NAMES.REFRESH)?.value ?? null;
  } catch (error) {
    console.error('[Session] Failed to read refresh token cookie:', error);
    return null;
  }
}
