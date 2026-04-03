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
    const idpTokenUrl = new URL('/api/auth/oauth2/token', oauthConfig.idpUrl).toString();
    console.log('[Callback] Exchanging code for token at:', idpTokenUrl);
    
    const tokenResponse = await exchangeCodeForToken(code, stateData.verifier);
    const statusCode = tokenResponse.status;
    console.log('[Callback] Token response status:', statusCode);

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[Callback] Token exchange failed. Status:', statusCode, 'Body:', errorText);
      return NextResponse.redirect(
        new URL(`/login?error=token_exchange_failed&status=${statusCode}&details=${encodeURIComponent(errorText)}`, request.url)
      );
    }

    const tokenText = await tokenResponse.text();
    console.log('[Callback] Token response body (first 50 chars):', tokenText.substring(0, 50));
    const tokens = JSON.parse(tokenText);
    console.log('[Callback] Token exchange success');

    // 获取用户信息
    console.log('[Callback] Fetching user info from:', new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl).toString());
    const userinfoResponse = await fetch(
      new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl).toString(),
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );
    console.log('[Callback] User info response status:', userinfoResponse.status);

    let userInfo: { email: string; name: string; picture?: string } | undefined;
    if (userinfoResponse.ok) {
      const userinfoText = await userinfoResponse.text();
      console.log('[Callback] User info response body:', userinfoText);
      try {
        const userinfo = JSON.parse(userinfoText);
        userInfo = {
          email: userinfo.email,
          name: userinfo.name || userinfo.email,
          picture: userinfo.picture,
        };
      } catch (e) {
        console.error('[Callback] Failed to parse user info JSON:', e);
      }
    } else {
      const errorText = await userinfoResponse.text();
      console.warn('[Callback] User info fetch failed. Status:', userinfoResponse.status, 'Body:', errorText);
    }

    // 创建 Session
    console.log('[Callback] Creating session for:', userInfo?.email);
    const session = await createSession({
      userId: userInfo?.email || 'unknown',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 3600,
      userInfo,
    });
    console.log('[Callback] Session created:', session.id);

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