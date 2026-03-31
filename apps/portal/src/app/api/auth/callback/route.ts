/**
 * OAuth 回调处理
 * 处理 IdP 授权码回调，交换 Token，创建 Session
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import {
  createSession,
  setSessionCookie,
  SESSION_CONFIG,
} from '@/lib/session';

export const runtime = 'nodejs';

/**
 * GET /api/auth/callback
 * OAuth 授权码回调处理
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // 处理 OAuth 错误
    if (error) {
      console.error('[Callback] OAuth error:', error, errorDescription);
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(errorDescription || error)}`, request.url)
      );
    }

    // 验证必要参数
    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/login?error=invalid_request', request.url)
      );
    }

    // 从 Cookie 获取之前存储的 state 数据
    const storedState = request.cookies.get('oauth_state')?.value;
    const stateDataStr = request.cookies.get('oauth_state_data')?.value;

    if (!storedState || !stateDataStr) {
      return NextResponse.redirect(
        new URL('/login?error=session_expired', request.url)
      );
    }

    // 验证 state
    if (state !== storedState) {
      console.error('[Callback] State mismatch:', { expected: storedState, received: state });
      return NextResponse.redirect(
        new URL('/login?error=invalid_state', request.url)
      );
    }

    // 解析 state 数据
    let stateData: { verifier: string; nonce: string; redirect: string; createdAt: number };
    try {
      stateData = JSON.parse(stateDataStr);
    } catch {
      return NextResponse.redirect(
        new URL('/login?error=invalid_state_data', request.url)
      );
    }

    // 检查 state 是否过期（10 分钟）
    if (Date.now() - stateData.createdAt > 600000) {
      return NextResponse.redirect(
        new URL('/login?error=state_expired', request.url)
      );
    }

    // 使用授权码换取 Token
    const tokenResponse = await exchangeCodeForToken(code, stateData.verifier);

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('[Callback] Token exchange failed:', errorData);
      return NextResponse.redirect(
        new URL('/login?error=token_exchange_failed', request.url)
      );
    }

    const tokens = await tokenResponse.json();

    // 获取用户信息
    const userinfoResponse = await fetch(
      new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl).toString(),
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );

    let userInfo: { email: string; name: string; picture?: string } | undefined;
    if (userinfoResponse.ok) {
      const userinfo = await userinfoResponse.json();
      userInfo = {
        email: userinfo.email,
        name: userinfo.name || userinfo.email,
        picture: userinfo.picture,
      };
    }

    // 创建 Session
    const session = await createSession({
      userId: userInfo?.email || 'unknown',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 3600,
      userInfo,
    });

    // 创建响应并设置 Session Cookie
    const redirectUrl = new URL(stateData.redirect || '/', request.url);
    const response = NextResponse.redirect(redirectUrl);

    // 设置 Session Cookie
    setSessionCookie(response, session.id);

    // 清理临时 Cookie
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_state_data');

    return response;
  } catch (error) {
    console.error('[Callback] Error:', error);
    return NextResponse.redirect(
      new URL('/login?error=callback_failed', request.url)
    );
  }
}

/**
 * 使用授权码换取 Token
 */
async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<Response> {
  const tokenUrl = new URL('/api/auth/oauth2/token', oauthConfig.idpUrl);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthConfig.redirectUri,
    client_id: oauthConfig.clientId,
    code_verifier: codeVerifier,
  });

  // 如果有 client_secret，添加到请求体
  if (oauthConfig.clientSecret) {
    body.append('client_secret', oauthConfig.clientSecret);
  }

  return fetch(tokenUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
}