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
import { getAppBaseURL, isCookieSecure } from '@/lib/env';
import { safeRedirectPath } from '@/lib/oauth-utils';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { revokeJti, revokeUserAccessByUserId } from '@/lib/session/revoke';
import { revokeRefreshTokenByTokenHash, revokeUserRefreshTokens } from '@/lib/auth/token/revocation';
import { createLogger } from '@/lib/logger';

const log = createLogger('Logout');
import { verifyAccessToken } from '@/lib/auth/token';
import { decodeJwtPayload } from '@/lib/session/jwt';
import { getRefreshTokenFromCookie } from '@/lib/session/cookies';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { COOKIE_NAMES, JWT_TYP, PORTAL_CLIENT_ID } from '@auth-sso/contracts';
import { isTrustedTopLevelNavigation } from '@/lib/auth/navigation-trust';
import { AUTH_REQUEST_BINDING_COOKIE } from '@/lib/session/auth-request-store';
import { writeLoginLog, extractClientIP, extractUserAgent } from '@/lib/audit';
import { hashToken } from '@/lib/crypto';

async function revokeAccessJwt(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<string | undefined> {
  try {
    const jwtToken = cookieStore.get(COOKIE_NAMES.JWT)?.value;
    if (!jwtToken) return undefined;
    const claims = await verifyAccessToken(jwtToken, PORTAL_CLIENT_ID, JWT_TYP.ACCESS_TOKEN);
    if (!claims?.sub) return undefined;
    if (claims.jti && claims.exp) await revokeJti(claims.jti, claims.exp);
    return claims.sub;
  } catch (err) {
    const mapped = mapDomainError(err);
    log.error('JWT 解码异常', { error: mapped.error, message: mapped.message });
    return undefined;
  }
}

async function revokeLoginSessionJti(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<void> {
  try {
    const loginSession = cookieStore.get(COOKIE_NAMES.LOGIN_SESSION)?.value;
    if (!loginSession) return;
    const payload = decodeJwtPayload(loginSession);
    if (payload?.jti && payload.exp) await revokeJti(payload.jti, payload.exp);
  } catch (e) {
    log.error('Login Session jti 撤销失败', { error: (e as Error).message });
  }
}

async function revokeCurrentRefresh(): Promise<void> {
  try {
    const refreshToken = await getRefreshTokenFromCookie();
    if (refreshToken) await revokeRefreshTokenByTokenHash(db, hashToken(refreshToken));
  } catch (e) {
    log.error('Refresh Token 撤销失败', { error: (e as Error).message });
  }
}

async function revokeAllUserTokens(userId: string): Promise<string> {
  try {
    await revokeUserRefreshTokens(db, userId);
  } catch (e) {
    log.error('批量撤销 Refresh Token 失败', { error: (e as Error).message });
  }
  await revokeUserAccessByUserId(userId);
  try {
    const user = await db
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return user[0]?.username || userId;
  } catch {
    return userId;
  }
}

async function performRevocation(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<{ userId?: string; username?: string }> {
  // 1. Access JWT：jti 黑名单（Gateway 离线验签即时拦截）
  const userId = await revokeAccessJwt(cookieStore);

  // 2. Login Session jti 黑名单
  await revokeLoginSessionJti(cookieStore);

  // 3. 当前 Refresh Token 标记 revoked
  await revokeCurrentRefresh();

  // 4. 按用户撤销全部 RT + 批量撤销 AT（防御纵深）
  const username = userId ? await revokeAllUserTokens(userId) : undefined;
  return { userId, username };
}

function clearAuthCookies(response: NextResponse) {
  // Path 必须与写入时完全一致，浏览器才会删除 Cookie：
  // - JWT / REFRESH 写在 path='/'，清除也用 '/'
  // - LOGIN_SESSION 写在 path='/api/auth/oauth2/authorize'（见 login/route.ts），清除须用同 Path
  //
  // 2026-10-13：清除侧补上 `secure`——**属性策略必须与写入侧一致**。
  // RFC 6265bis 的 cookie protection 下，非 Secure 的清除 Cookie 无法覆盖 Secure 的同名 Cookie，
  // 于是 COOKIE_SECURE=true 而请求未被视为安全（如 TLS 在别处终结）时，登出**清不掉**会话 Cookie。
  // 此前三处清除里只有 oauth-utils 带了 secure。
  const secure = isCookieSecure();
  response.cookies.set(COOKIE_NAMES.JWT, '', { path: '/', httpOnly: true, secure, sameSite: 'lax', maxAge: 0 });
  response.cookies.set(COOKIE_NAMES.LOGIN_SESSION, '', { path: '/api/auth/oauth2/authorize', httpOnly: true, secure, sameSite: 'lax', maxAge: 0 });
  response.cookies.set(COOKIE_NAMES.REFRESH, '', { path: '/', httpOnly: true, secure, sameSite: 'lax', maxAge: 0 });
  // 授权请求绑定 Cookie（H-02）：登出时一并清除，避免残留未消费的绑定值
  response.cookies.set(AUTH_REQUEST_BINDING_COOKIE, '', { path: '/api/auth', httpOnly: true, secure, sameSite: 'lax', maxAge: 0 });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const { userId, username } = await performRevocation(cookieStore);

  if (userId && username) {
    writeLoginLog({ userId, username, eventType: 'LOGOUT', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers) });
  }

  // 确认页的表单提交（导航语义）→ 302 回可读页面；fetch/XHR 客户端保持原 JSON 契约。
  const isBrowserFormSubmit =
    request.headers.get('sec-fetch-mode') === 'navigate' ||
    (request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
  if (isBrowserFormSubmit) {
    const backUrl = safeRedirectPath(new URL(request.url).searchParams.get('back_url')) ?? '/login';
    const redirectResponse = NextResponse.redirect(new URL(backUrl, getAppBaseURL()));
    clearAuthCookies(redirectResponse);
    return redirectResponse;
  }

  const response = NextResponse.json({});
  clearAuthCookies(response);
  return response;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 跨站/来源不明的 GET 导航 → 只返回确认页，**不执行任何状态变更**（H-09）。
 *
 * 攻击者页面 `<a href=".../api/auth/logout">` 因 `SameSite=Lax` 会带上会话 Cookie，
 * 但本页不会被自动提交（跨站表单 POST 会被 proxy.ts 的 Origin 校验 403），
 * 用户必须显式点击"确认退出"才真正登出。
 */
function renderLogoutConfirmPage(backUrl: string | null): string {
  const action = backUrl
    ? `/api/auth/logout?back_url=${encodeURIComponent(backUrl)}`
    : '/api/auth/logout';
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<title>确认退出登录</title></head>',
    '<body><main style="font-family:system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:1.5rem">',
    '<h1>确认退出登录？</h1>',
    '<p>此操作将撤销当前会话及该账号的全部刷新令牌。</p>',
    `<form method="post" action="${escapeHtml(action)}">`,
    '<button type="submit">确认退出</button> ',
    `<a href="${escapeHtml(backUrl ?? '/dashboard')}">取消</a>`,
    '</form></main></body></html>',
  ].join('');
}

/**
 * GET /api/auth/logout?back_url=...
 *
 * - **可信顶级导航**（同源链接 / 地址栏直达）：保留 H-SSO-004 四层撤销并 302。
 * - **跨站或来源不明导航**：返回确认页，不做任何状态变更（H-09 CSRF 修复）。
 */
export async function GET(request: NextRequest) {
  const backUrlRaw = new URL(request.url).searchParams.get('back_url');
  const backUrl = safeRedirectPath(backUrlRaw);

  if (!isTrustedTopLevelNavigation(request)) {
    return new NextResponse(renderLogoutConfirmPage(backUrl), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
      },
    });
  }

  const cookieStore = await cookies();
  const { userId, username } = await performRevocation(cookieStore);

  if (userId && username) {
    writeLoginLog({ userId, username, eventType: 'LOGOUT', ip: extractClientIP(request.headers), userAgent: extractUserAgent(request.headers) });
  }

  const publicBase = getAppBaseURL();
  const target = backUrl ?? '/login';
  const response = NextResponse.redirect(new URL(target, publicBase));
  clearAuthCookies(response);
  return response;
}
