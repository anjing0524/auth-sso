/**
 * 登出 API (POST /api/auth/logout)
 *
 * 四层撤销闭环（R30 / §8.3 防线六）：
 * 1. Access Token jti → Redis 黑名单（Gateway 离线验签实时拦截）
 * 2. Login Session Token jti → Redis 黑名单
 * 3. Refresh Token → DB revoked 标记（阻止 refresh 端点续期）
 * 4. 按用户 ID 撤销全部 Refresh Token（防御纵深，杜绝遗漏）
 *
 * Cookie 三步清除（即使撤销失败也清除，保证客户端状态一致）：
 *   portal_jwt_token + login_session + portal_refresh_token
 *
 * @route POST /api/auth/logout
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAppBaseURL } from '@/lib/env';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { revokeJti } from '@/lib/session/revoke';
import { verifyAccessToken } from '@/lib/auth/token';
import { decodeJwtPayload } from '@/lib/session/jwt';
import { getRefreshTokenFromCookie } from '@/lib/session/cookies';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';


async function performRevocation(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<{ userId?: string; username?: string }> {
  let userId: string | undefined;
  let username: string | undefined;
  try {
    // 1. 撤销 portal_jwt_token 的 jti（Access Token）
    const jwtToken = cookieStore.get(COOKIE_NAMES.JWT)?.value;
    if (jwtToken) {
      const claims = await verifyAccessToken(jwtToken);
      if (claims?.jti && claims.exp) {
        await revokeJti(claims.jti, claims.exp);
        userId = claims.sub;
      }
    }

    // 查询用户名用于日志（轻量主键查询）
    if (userId) {
      const user = await db
        .select({ username: schema.users.username })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      username = user[0]?.username || userId;
    }

    // 2. 撤销 login_session 的 jti（Login Session Token）
    const loginSession = cookieStore.get(COOKIE_NAMES.LOGIN_SESSION)?.value;
    if (loginSession) {
      const payload = decodeJwtPayload(loginSession);
      if (payload?.jti && payload.exp) {
        await revokeJti(payload.jti, payload.exp);
      }
    }

    // 3. 撤销 Refresh Token — DB 标记 revoked（阻止 refresh 端点续期）
    const refreshToken = await getRefreshTokenFromCookie();
    if (refreshToken) {
      await db
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        .where(eq(schema.refreshTokens.tokenHash, refreshToken));
    }

    // 4. 按用户 ID 撤销全部 Refresh Token（防御纵深）
    if (userId) {
      await db
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        .where(eq(schema.refreshTokens.userId, userId));
    }
  } catch (err) {
    const mapped = mapDomainError(err);
    console.error('[Logout API] 登出异常:', mapped.message, err instanceof Error ? err.stack : '');
  }
  return { userId, username };
}

function clearAuthCookies(response: NextResponse) {
  response.cookies.set(COOKIE_NAMES.JWT, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
  response.cookies.set(COOKIE_NAMES.LOGIN_SESSION, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
  response.cookies.set(COOKIE_NAMES.REFRESH, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const { userId, username } = await performRevocation(cookieStore);

  if (userId && username) {
    writeLoginLog({ userId, username, eventType: 'LOGOUT', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers) });
  }

  const response = NextResponse.json({ success: true });
  clearAuthCookies(response);
  return response;
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const { userId, username } = await performRevocation(cookieStore);

  if (userId && username) {
    writeLoginLog({ userId, username, eventType: 'LOGOUT', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers) });
  }

  const publicBase = getAppBaseURL();
  const response = NextResponse.redirect(new URL('/login', publicBase));
  clearAuthCookies(response);
  return response;
}
