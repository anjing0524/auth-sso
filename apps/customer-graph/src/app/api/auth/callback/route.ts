/**
 * OAuth 回调处理
 * 处理 IdP 授权码回调，交换 Token，创建 Session
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import {
  createSession,
  setSessionCookie,
} from '@/lib/session';
import { decodeJwt } from 'jose';

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
      console.error('[Callback-CG] OAuth error:', error, errorDescription);
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
      console.error('[Callback-CG] State mismatch:', { expected: storedState, received: state });
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
    console.log('[Callback-CG] Exchanging code for token at:', idpTokenUrl);

    const tokenResponse = await exchangeCodeForToken(code, stateData.verifier);
    const statusCode = tokenResponse.status;
    console.log('[Callback-CG] Token response status:', statusCode);

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[Callback-CG] Token exchange failed. Status:', statusCode, 'Body:', errorText);

      // 提取错误详情
      const debugInfo = (tokenResponse as Response & { _debugInfo?: string })._debugInfo || '';
      const detailInfo = `${errorText || `HTTP ${statusCode}`} [${debugInfo}]`;

      return NextResponse.redirect(
        new URL(`/login?error=token_exchange_failed&status=${statusCode}&details=${encodeURIComponent(detailInfo)}`, request.url)
      );
    }

    const tokenText = await tokenResponse.text();
    console.log('[Callback-CG] Token response body (first 50 chars):', tokenText.substring(0, 50));
    const tokens = JSON.parse(tokenText);
    console.log('[Callback-CG] Token exchange success');

    // 校验 id_token 中的 nonce (OIDC 安全加固)
    if (!tokens.id_token) {
      console.error('[Callback-CG] No id_token returned in OIDC flow');
      return NextResponse.redirect(
        new URL('/login?error=missing_id_token', request.url)
      );
    }

    try {
      const decoded = decodeJwt(tokens.id_token);
      const decodedNonce = decoded['nonce'];
      console.log('[Callback-CG] id_token nonce:', decodedNonce);
      console.log('[Callback-CG] Expected nonce:', stateData.nonce);

      if (!decodedNonce || decodedNonce !== stateData.nonce) {
        console.error('[Callback-CG] Nonce mismatch or missing');
        return NextResponse.redirect(
          new URL('/login?error=nonce_mismatch', request.url)
        );
      }
      console.log('[Callback-CG] Nonce verification passed');
    } catch (e) {
      console.error('[Callback-CG] Failed to decode id_token:', e);
      return NextResponse.redirect(
        new URL('/login?error=invalid_id_token', request.url)
      );
    }

    // 获取用户信息
    console.log('[Callback-CG] Fetching user info from:', new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl).toString());
    const userinfoResponse = await fetch(
      new URL('/api/auth/oauth2/userinfo', oauthConfig.idpUrl).toString(),
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );
    console.log('[Callback-CG] User info response status:', userinfoResponse.status);

    let userInfo: { email: string; name: string; picture?: string } | undefined;
    if (userinfoResponse.ok) {
      const userinfoText = await userinfoResponse.text();
      console.log('[Callback-CG] User info response body:', userinfoText);
      try {
        const userinfo = JSON.parse(userinfoText);
        userInfo = {
          email: userinfo.email,
          name: userinfo.name || userinfo.email,
          picture: userinfo.picture,
        };
      } catch (e) {
        console.error('[Callback-CG] Failed to parse user info JSON:', e);
      }
    } else {
      const errorText = await userinfoResponse.text();
      console.warn('[Callback-CG] User info fetch failed. Status:', userinfoResponse.status, 'Body:', errorText);
    }

    // 创建 Session
    console.log('[Callback-CG] Creating session for:', userInfo?.email);
    const session = await createSession({
      userId: userInfo?.email || 'unknown',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 3600,
      userInfo,
    });
    console.log('[Callback-CG] Session created:', session.id);

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
    console.error('[Callback-CG] Error:', error);
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

  // 生产环境下强制从环境变量读取最新的 Secret
  const clientSecret = (process.env['IDP_CLIENT_SECRET'] || oauthConfig.clientSecret || '').trim();
  const clientId = oauthConfig.clientId;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthConfig.redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  // OAuth 2.1 规范：机密客户端推荐使用 client_secret_post (Body) 或 client_secret_basic (Header)
  // 我们选择 Body 方式，因为它在各种代理和 Serverless 环境下最稳定。
  // 注意：绝不能同时发送 Header 和 Body 中的 Secret。
  if (clientSecret) {
    body.append('client_secret', clientSecret);
  }

  const response = await fetch(tokenUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  // 如果失败，在 response 对象上附加调试信息
  if (!response.ok) {
    const secretExists = clientSecret ? `YES(${clientSecret.substring(0, 4)})` : 'NO';
    (response as Response & { _debugInfo?: string })._debugInfo = `SecretPresent:${secretExists}|AuthMethod:POST_BODY`;
  }

  return response;
}