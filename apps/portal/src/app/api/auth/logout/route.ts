/**
 * 登出处理
 * 清除 Portal Session 和 IdP Session
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import {
  getSession,
  getSessionIdFromCookie,
  deleteSession,
  clearSessionCookie,
} from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/auth/logout
 * 登出当前用户
 */
export async function POST(request: NextRequest) {
  try {
    const sessionId = await getSessionIdFromCookie();

    // 获取 Session 信息用于撤销 Token
    let accessToken: string | undefined;
    let refreshToken: string | undefined;

    if (sessionId) {
      const session = await getSession(sessionId);
      if (session) {
        accessToken = session.accessToken;
        refreshToken = session.refreshToken;
        // 删除 Redis 中的 Session
        await deleteSession(sessionId);
      }
    }

    // 清除响应
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);

    // 如果有 refresh_token，通知 IdP 撤销
    if (refreshToken) {
      try {
        await revokeToken(refreshToken, 'refresh_token');
      } catch (error) {
        console.error('[Logout] Failed to revoke token:', error);
        // 继续执行，不阻止登出
      }
    }

    // 调用 IdP 登出端点，清除 IdP Session
    if (accessToken) {
      try {
        const idpLogoutUrl = new URL('/api/auth/sign-out', oauthConfig.idpUrl);
        await fetch(idpLogoutUrl.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      } catch (error) {
        console.error('[Logout] Failed to sign out from IdP:', error);
        // 继续执行，不阻止登出
      }
    }

    return response;
  } catch (error) {
    console.error('[Logout] Error:', error);
    return NextResponse.json(
      { error: 'logout_failed', message: '登出失败' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/logout
 * 重定向到 IdP 登出页面
 */
export async function GET(request: NextRequest) {
  const redirect = request.nextUrl.searchParams.get('redirect') || '/';
  const sessionId = await getSessionIdFromCookie();

  // 删除 Redis 中的 Session
  if (sessionId) {
    await deleteSession(sessionId);
  }

  // 清除 Portal Session Cookie
  const response = NextResponse.redirect(
    new URL(`/api/auth/login?redirect=${encodeURIComponent(redirect)}`, request.url)
  );
  clearSessionCookie(response);

  return response;
}

/**
 * 撤销 Token
 */
async function revokeToken(token: string, tokenTypeHint: string): Promise<void> {
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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token revocation failed: ${response.status}`);
  }
}