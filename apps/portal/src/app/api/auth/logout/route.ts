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
 * @impl H-SSO-004 — 全链路登出清理（AT + RT + Cookie）
 * @impl H-SESS-006 — 账户异常即时失效（jti 黑名单）
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

  // 1. 解码 JWT 获取 userId/jti/exp（非关键路径：失败不影响后续撤销步骤）
  try {
    const jwtToken = cookieStore.get(COOKIE_NAMES.JWT)?.value;
    if (jwtToken) {
      const claims = await verifyAccessToken(jwtToken);
      if (claims?.sub) {
        userId = claims.sub;
        const jti = claims.jti;
        const jtiExp = claims.exp;
        // jti 黑名单写入（Gateway 离线验签即时拦截）— 每个步骤独立 try/catch
        if (jti && jtiExp) {
          try {
            await revokeJti(jti, jtiExp);
          } catch (e) {
            log.error('Access Token jti 撤销失败', { error: (e as Error).message });
          }
        }
      }
    }
  } catch (err) {
    const mapped = mapDomainError(err);
    log.error('JWT 解码异常', { error: mapped.error, message: mapped.message });
  }

  // 2. 撤销 login_session 的 jti（独立 try/catch）
  try {
    const loginSession = cookieStore.get(COOKIE_NAMES.LOGIN_SESSION)?.value;
    if (loginSession) {
      const payload = decodeJwtPayload(loginSession);
      if (payload?.jti && payload.exp) {
        await revokeJti(payload.jti, payload.exp);
      }
    }
  } catch (e) {
    log.error('Login Session jti 撤销失败', { error: (e as Error).message });
  }

  // 3. DB: 标记当前 Refresh Token revoked（阻止 refresh 端点续期）
  try {
    const refreshToken = await getRefreshTokenFromCookie();
    if (refreshToken) {
      await db
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        .where(eq(schema.refreshTokens.tokenHash, hashToken(refreshToken)));
    }
  } catch (e) {
    log.error('Refresh Token 撤销失败', { error: (e as Error).message });
  }

  // 4. DB: 按用户 ID 撤销全部 Refresh Token + 批量撤销 Access Token（防御纵深）
  if (userId) {
    try {
      await db
        .update(schema.refreshTokens)
        .set({ revoked: new Date() })
        .where(eq(schema.refreshTokens.userId, userId));
    } catch (e) {
      log.error('批量撤销 Refresh Token 失败', { error: (e as Error).message });
    }

    try {
      await revokeUserAccessByUserId(userId);
    } catch (e) {
      log.error('批量撤销 Access Token 失败', { error: (e as Error).message });
    }

    // 5. 查询用户名用于日志（撤销完成后查询，失败不阻断）
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
