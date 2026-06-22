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
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { revokeJti } from '@/lib/session/revoke';
import { verifyAccessToken } from '@/lib/auth/token';
import { decodeJwtPayload } from '@/lib/session/jwt';
import { getRefreshTokenFromCookie } from '@/lib/session/cookies';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COOKIE_NAMES } from '@auth-sso/contracts';

export const runtime = 'nodejs';

export async function POST() {
  const response = NextResponse.json({ success: true });
  let userId: string | undefined;

  try {
    const cookieStore = await cookies();

    // 1. 撤销 portal_jwt_token 的 jti（Access Token）
    const jwtToken = cookieStore.get(COOKIE_NAMES.JWT)?.value;
    if (jwtToken) {
      const claims = await verifyAccessToken(jwtToken);
      if (claims?.jti && claims.exp) {
        await revokeJti(claims.jti, claims.exp);
        userId = claims.sub;
      }
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
        .where(eq(schema.refreshTokens.tokenHash, refreshToken))
        .execute();
    }

    // 4. 按用户 ID 撤销全部 Refresh Token（防御纵深）
    if (userId) {
      await db
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        .where(eq(schema.refreshTokens.userId, userId))
        .execute();
    }
  } catch (err) {
    const mapped = mapDomainError(err);
    console.error('[Logout API] 登出异常:', mapped.message, err instanceof Error ? err.stack : '');
  }

  // 无论撤销成功与否，始终清除全部 Cookie（保证客户端状态一致）
  response.cookies.set(COOKIE_NAMES.JWT, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
  response.cookies.set(COOKIE_NAMES.LOGIN_SESSION, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
  response.cookies.set(COOKIE_NAMES.REFRESH, '', { path: '/api/auth/refresh', httpOnly: true, sameSite: 'lax', maxAge: 0 });
  return response;
}
