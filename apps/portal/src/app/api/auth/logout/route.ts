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
import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAppBaseURL } from '@/lib/env';
import { safeRedirectPath } from '@/lib/oauth-utils';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { revokeJti, revokeUserAccessByUserId } from '@/lib/session/revoke';
import { createLogger } from '@/lib/logger';

const log = createLogger('Logout');
import { verifyAccessToken } from '@/lib/auth/token';
import { decodeJwtPayload } from '@/lib/session/jwt';
import { getRefreshTokenFromCookie } from '@/lib/session/cookies';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { hashToken } from '@/lib/crypto';

async function performRevocation(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<{ userId?: string; username?: string }> {
  let userId: string | undefined;
  let username: string | undefined;
  let jti: string | undefined;
  let jtiExp: number | undefined;
  try {
    // 1. 解码 JWT 获取 userId/jti/exp
    const jwtToken = cookieStore.get(COOKIE_NAMES.JWT)?.value;
    if (jwtToken) {
      const claims = await verifyAccessToken(jwtToken);
      if (claims?.sub) {
        userId = claims.sub;
        jti = claims.jti;
        jtiExp = claims.exp;
      }
    }

    // 2. DB: 标记当前 Refresh Token revoked（阻止 refresh 端点续期）
    const refreshToken = await getRefreshTokenFromCookie();
    if (refreshToken) {
      await db
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        // tokenHash 存储的是 SHA256(token)，查询时需同样 hash 匹配
        .where(eq(schema.refreshTokens.tokenHash, hashToken(refreshToken)));
    }

    // 3. Redis: jti 黑名单写入（Gateway 离线验签即时拦截）
    //    先于步骤 4 执行，确保 Token 立即失效。
    if (jti && jtiExp) {
      await revokeJti(jti, jtiExp);
    }

    // 撤销 login_session 的 jti
    const loginSession = cookieStore.get(COOKIE_NAMES.LOGIN_SESSION)?.value;
    if (loginSession) {
      const payload = decodeJwtPayload(loginSession);
      if (payload?.jti && payload.exp) {
        await revokeJti(payload.jti, payload.exp);
      }
    }

    // 4. DB: 按用户 ID 撤销全部 Refresh Token（防御纵深，单独 try/catch）
    //    放在 jti 黑名单之后执行：Redis 是实时拦截线，DB 是续期阻断线，
    //    两者失败不应互相影响。
    if (userId) {
      try {
        await db
          .update(schema.refreshTokens)
          .set({ revoked: new Date() })
          .where(eq(schema.refreshTokens.userId, userId));
      } catch (e) {
        log.error('批量撤销 Refresh Token 失败', { error: (e as Error).message });
      }

      // 5. 批量撤销所有活跃 Access Token（jti 黑名单写入 + 清除 user→jti 映射）
      try {
        await revokeUserAccessByUserId(userId);
      } catch (e) {
        log.error('批量撤销 Access Token 失败', { error: (e as Error).message });
      }
    }

    // 6. DB: 查询用户名用于日志（撤销完成后查询，失败不阻断）
    if (userId) {
      try {
        const user = await db
          .select({ username: schema.users.username })
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .limit(1);
        username = user[0]?.username || userId;
      } catch {
        username = userId;
      }
    }
  } catch (err) {
    const mapped = mapDomainError(err);
    log.error('登出异常', { error: mapped.error, message: mapped.message });
  }
  return { userId, username };
}

function clearAuthCookies(response: NextResponse) {
  // Path 必须与写入时完全一致，浏览器才会删除 Cookie：
  // - JWT / REFRESH 写在 path='/'，清除也用 '/'
  // - LOGIN_SESSION 写在 path='/api/auth/oauth2/authorize'（见 login/route.ts），清除须用同 Path
  response.cookies.set(COOKIE_NAMES.JWT, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
  response.cookies.set(COOKIE_NAMES.LOGIN_SESSION, '', { path: '/api/auth/oauth2/authorize', httpOnly: true, sameSite: 'lax', maxAge: 0 });
  response.cookies.set(COOKIE_NAMES.REFRESH, '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const { userId, username } = await performRevocation(cookieStore);

  if (userId && username) {
    writeLoginLog({ userId, username, eventType: 'LOGOUT', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers) });
  }

  const response = NextResponse.json({});
  clearAuthCookies(response);
  return response;
}

/** GET /api/auth/logout?back_url=... → 302 重定向（浏览器端直接导航使用） */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const { userId, username } = await performRevocation(cookieStore);

  if (userId && username) {
    writeLoginLog({ userId, username, eventType: 'LOGOUT', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers) });
  }

  const backUrl = new URL(request.url).searchParams.get('back_url');
  const publicBase = getAppBaseURL();
  const target = backUrl && safeRedirectPath(backUrl) ? backUrl : '/login';
  const response = NextResponse.redirect(new URL(target, publicBase));
  clearAuthCookies(response);
  return response;
}
