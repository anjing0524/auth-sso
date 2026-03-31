/**
 * OAuth 回调处理 API
 * GET /api/auth/callback - 处理 IdP 回调
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/oauth';
import { consumeOAuthState, setSession, DemoSession } from '@/lib/session';

export const runtime = 'nodejs';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

interface UserInfoResponse {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  [key: string]: unknown;
}

/**
 * GET /api/auth/callback
 * 处理 OAuth 回调，交换 token，获取用户信息
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // 检查是否有错误
    if (error) {
      console.error('[DemoApp] OAuth Error:', error, errorDescription);
      return NextResponse.redirect(
        new URL(`/?error=${encodeURIComponent(errorDescription || error)}`, oauthConfig.appUrl)
      );
    }

    // 验证必要参数
    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/?error=invalid_callback', oauthConfig.appUrl)
      );
    }

    // 获取并验证 OAuth 状态
    const oauthState = await consumeOAuthState();
    if (!oauthState) {
      return NextResponse.redirect(
        new URL('/?error=state_expired', oauthConfig.appUrl)
      );
    }

    // 验证 state
    if (state !== oauthState.state) {
      console.error('[DemoApp] State mismatch');
      return NextResponse.redirect(
        new URL('/?error=state_mismatch', oauthConfig.appUrl)
      );
    }

    // 用授权码换取 token
    const tokenResponse = await exchangeCodeForToken(code, oauthState.codeVerifier);

    if (!tokenResponse.access_token) {
      return NextResponse.redirect(
        new URL('/?error=token_exchange_failed', oauthConfig.appUrl)
      );
    }

    // 获取用户信息
    const userInfo = await fetchUserInfo(tokenResponse.access_token);

    // 创建 Session
    const session: DemoSession = {
      userId: userInfo.sub,
      email: userInfo.email || '',
      name: userInfo.name || '',
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
    };

    await setSession(session);

    // 重定向到目标页面
    const redirectUrl = oauthState.redirect || '/';
    return NextResponse.redirect(new URL(redirectUrl, oauthConfig.appUrl));
  } catch (error) {
    console.error('[DemoApp] Callback Error:', error);
    return NextResponse.redirect(
      new URL('/?error=callback_failed', oauthConfig.appUrl)
    );
  }
}

/**
 * 用授权码换取 Token
 */
async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<TokenResponse> {
  const response = await fetch(oauthConfig.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauthConfig.redirectUri,
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[DemoApp] Token exchange failed:', response.status, errorText);
    throw new Error('Token exchange failed');
  }

  return response.json();
}

/**
 * 获取用户信息
 */
async function fetchUserInfo(accessToken: string): Promise<UserInfoResponse> {
  const response = await fetch(oauthConfig.userInfoEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }

  return response.json();
}