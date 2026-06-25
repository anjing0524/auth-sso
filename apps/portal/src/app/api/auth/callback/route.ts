/**
 * Portal OAuth Callback (GET /api/auth/callback)
 *
 * OAuth 2.1 Authorization Code 流程的最后一步。
 * 接收 authorize 端点签发的 code → 内部调用 token 端点换取 Token → Set-Cookie → 302 回到目标页。
 *
 * Portal 自身也是 OAuth Client（client_id=portal），此端点处理 Portal SPA 的 SSO 回调。
 *
 * @route GET /api/auth/callback
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseURL, getEnvConfig } from '@/lib/env';
import { COOKIE_NAMES, TOKEN_TTL } from '@auth-sso/contracts';


export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  // 公网 base URL（给浏览器的重定向用），不能依赖 url.origin（Docker 下是容器内部 hostname）
  const publicBase = getAppBaseURL();

  if (!code) {
    const errorUrl = new URL('/login', publicBase);
    errorUrl.searchParams.set('error', 'token_exchange_failed');
    return NextResponse.redirect(errorUrl);
  }

  const codeVerifier = url.searchParams.get('pkce_verifier');
  if (!codeVerifier) {
    const errorUrl = new URL('/login', publicBase);
    errorUrl.searchParams.set('error', 'invalid_state');
    return NextResponse.redirect(errorUrl);
  }

  // 内部调用 token 端点：用 code + PKCE verifier 换 token
  const env = getEnvConfig();
  const portalClientSecret = env.PORTAL_CLIENT_SECRET || 'portal-secret';
  const internalBase = process.env.PORTAL_INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;

  // redirect_uri 必须与 authorize 请求一致（含 pkce_verifier），否则 token 端点精确比对失败
  const redirectUri = new URL('/api/auth/callback', publicBase);
  redirectUri.searchParams.set('pkce_verifier', codeVerifier);

  const tokenUrl = new URL('/api/auth/oauth2/token', internalBase);
  try {
    console.error('[Callback] DEBUG tokenUrl=%s redirectUri=%s', tokenUrl.toString(), redirectUri.toString());
    const tokenRes = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: 'portal',
        client_secret: portalClientSecret,
        redirect_uri: redirectUri.toString(),
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[Callback] Token 交换失败:', await tokenRes.text());
      const errorUrl = new URL('/login', publicBase);
      errorUrl.searchParams.set('error', 'token_exchange_failed');
      return NextResponse.redirect(errorUrl);
    }

    const tokens = await tokenRes.json();

    const isProduction = process.env.NODE_ENV === 'production';
    const isLocal = request.headers.get('host')?.includes('localhost') || request.headers.get('host')?.includes('127.0.0.1');
    const secure = isProduction && !isLocal;
    const targetUrl = state || '/dashboard';

    const response = NextResponse.redirect(new URL(targetUrl, publicBase));

    response.cookies.set(COOKIE_NAMES.JWT, tokens.access_token, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: tokens.expires_in || 3600,
    });

    if (tokens.refresh_token) {
      response.cookies.set(COOKIE_NAMES.REFRESH, tokens.refresh_token, {
        path: '/',
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: TOKEN_TTL.REFRESH_TOKEN,
      });
    }

    return response;
  } catch (err) {
    console.error('[Callback] Token 交换异常:', err);
    const errorUrl = new URL('/login', publicBase);
    errorUrl.searchParams.set('error', 'token_exchange_failed');
    return NextResponse.redirect(errorUrl);
  }
}
