/**
 * 登出处理（JWT Cookie 无状态版）
 *
 * 不再需要查 Redis Session。
 * - 清除 portal_jwt_token 和 portal_refresh_token Cookie
 * - 向 IdP 撤销 Refresh Token（通知 IdP 全局登出）
 * - 可选：将 jti 加入黑名单实现即时失效
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import {
  getJwtFromCookie,
  getRefreshTokenFromCookie,
  clearJwtCookies,
  decodeJwtPayload,
  revokeJti,
} from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/auth/logout
 * 登出当前用户（清除 Cookie + 撤销 Refresh Token + jti 黑名单）
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 读取当前 Token（用于撤销和 jti 黑名单）
    const accessToken = await getJwtFromCookie();
    const refreshToken = await getRefreshTokenFromCookie();

    // 2. 将 jti 加入黑名单，实现 Access Token 即时失效（网关和 Portal 均会检查）
    if (accessToken) {
      const payload = decodeJwtPayload(accessToken);
      if (payload?.jti && payload.exp) {
        await revokeJti(payload.jti, payload.exp);
      }
    }

    // 3. 向 IdP 撤销 Refresh Token（全局 SSO 登出）
    if (refreshToken) {
      revokeTokenAtIdP(refreshToken, 'refresh_token').catch(err => {
        console.error('[Logout] IdP Refresh Token 撤销失败:', err);
      });
    }

    // 4. 构建响应并清除所有 JWT Cookie
    const response = NextResponse.json({ success: true });
    clearJwtCookies(response);

    return response;
  } catch (error) {
    console.error('[Logout] 登出流程异常:', error);
    return NextResponse.json({ error: 'logout_failed', message: '登出失败' }, { status: 500 });
  }
}

/**
 * GET /api/auth/logout
 * 页面级登出重定向（兼容旧式 href 跳转场景）
 */
export async function GET(request: NextRequest) {
  const redirect = request.nextUrl.searchParams.get('redirect') || '/';

  const accessToken = await getJwtFromCookie();
  const refreshToken = await getRefreshTokenFromCookie();

  // jti 黑名单
  if (accessToken) {
    const payload = decodeJwtPayload(accessToken);
    if (payload?.jti && payload.exp) {
      await revokeJti(payload.jti, payload.exp);
    }
  }

  // 向 IdP 撤销 Refresh Token（异步，不阻塞重定向）
  if (refreshToken) {
    revokeTokenAtIdP(refreshToken, 'refresh_token').catch(() => {});
  }

  const response = NextResponse.redirect(
    new URL(`/login?redirect=${encodeURIComponent(redirect)}`, request.url)
  );
  clearJwtCookies(response);

  return response;
}

/**
 * 向 IdP 撤销指定 Token
 *
 * @param token 需要撤销的 Token 字符串
 * @param tokenTypeHint Token 类型提示（'refresh_token' 或 'access_token'）
 */
async function revokeTokenAtIdP(token: string, tokenTypeHint: string): Promise<void> {
  const revokeUrl = new URL('/api/auth/oauth2/revoke', oauthConfig.idpUrl);

  const body = new URLSearchParams({
    token,
    token_type_hint: tokenTypeHint,
    client_id: oauthConfig.clientId,
  });

  if (oauthConfig.clientSecret) {
    body.append('client_secret', oauthConfig.clientSecret);
  }

  const response = await fetch(revokeUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token 撤销失败: HTTP ${response.status}`);
  }
}