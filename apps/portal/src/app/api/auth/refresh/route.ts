/**
 * Token 刷新 API (POST /api/auth/refresh)
 *
 * Refresh Token Rotation：消耗旧 RT，签发新 AT + RT。
 *
 * 优化：如果当前 Access Token 剩余时间 > 5 分钟，跳过刷新（避免无效的 token 轮换）。
 *
 * @route POST /api/auth/refresh
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getRefreshTokenFromCookie, getJwtFromCookie, decodeJwtPayload } from '@/lib/session';
import { rotateRefreshToken } from '@/lib/auth/token';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { AUTH_ERRORS, COOKIE_NAMES, TOKEN_TTL } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { isCookieSecure } from '@/lib/env';

/** 刷新阈值（秒）：仅当 Access Token 剩余时间 < 此值时执行刷新 */
const REFRESH_THRESHOLD = 5 * 60; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const refreshToken = await getRefreshTokenFromCookie();
    if (!refreshToken) {
      return NextResponse.json(
        { error: AUTH_ERRORS.REFRESH_TOKEN_MISSING, message: '缺少 Refresh Token' },
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
          return NextResponse.json({ skipped: true, remaining });
        }
      }
    }

    // 从当前 AT 中获取用户信息（用于日志）
    const currentAT = await getJwtFromCookie();
    const atPayload = currentAT ? decodeJwtPayload(currentAT) : null;
    const username = atPayload?.sub || 'unknown';
    const ip = extractClientIP(request.headers);
    const ua = extractUserAgent(request.headers);

    const result = await rotateRefreshToken(refreshToken);
    if (!result) {
      writeLoginLog({ userId: atPayload?.sub, username, eventType: 'TOKEN_REFRESH_FAILED', ip, userAgent: ua, failReason: 'Refresh Token 无效或已过期' });
      const response = NextResponse.json(
        { error: AUTH_ERRORS.REFRESH_TOKEN_INVALID, message: 'Refresh Token 无效或已过期' },
        { status: 401 },
      );
      // 清除无效 Cookie
      response.cookies.set(COOKIE_NAMES.JWT, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
      response.cookies.set(COOKIE_NAMES.REFRESH, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
      return response;
    }

    // 续签成功 → 记录 TOKEN_REFRESH 日志
    writeLoginLog({ userId: atPayload?.sub, username, eventType: 'TOKEN_REFRESH', ip, userAgent: ua });

    const secure = isCookieSecure();
    const response = NextResponse.json({ expiresIn: result.expiresIn });

    response.cookies.set(COOKIE_NAMES.JWT, result.accessToken, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: result.expiresIn,
    });

    response.cookies.set(COOKIE_NAMES.REFRESH, result.refreshToken, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: TOKEN_TTL.REFRESH_TOKEN,
    });

    return response;
  } catch (err) {
    const mapped = mapDomainError(err);
    return NextResponse.json(
      { error: mapped.error, message: mapped.message },
      { status: mapped.status },
    );
  }
}
