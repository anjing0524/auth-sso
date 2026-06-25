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
  const state = url.searchParams.get('state'); // state = 最终目标 URL

  if (!code) {
    const errorUrl = new URL('/login', url.origin);
    errorUrl.searchParams.set('error', 'token_exchange_failed');
    return NextResponse.redirect(errorUrl);
  }

  // H-AUTH-010: state 参数存在性校验（OAuth 2.1 PKCE §7.6 提供 CSRF 保护，此为纵深防御）
  if (!state) {
    const errorUrl = new URL('/login', url.origin);
    errorUrl.searchParams.set('error', 'invalid_state');
    return NextResponse.redirect(errorUrl);
  }

  // PKCE code_verifier 由 login form 通过 redirect_uri searchParams 传入
  const codeVerifier = url.searchParams.get('pkce_verifier');

  if (!codeVerifier) {
    const errorUrl = new URL('/login', url.origin);
    errorUrl.searchParams.set('error', 'invalid_state');
    return NextResponse.redirect(errorUrl);
  }

  // 内部调用 token 端点：用 code + PKCE verifier 换 token
  const env = getEnvConfig();
  const portalClientSecret = env.PORTAL_CLIENT_SECRET;
  if (!portalClientSecret) {
    console.error('[Callback] 缺少 PORTAL_CLIENT_SECRET 环境变量');
    const errorUrl = new URL('/login', url.origin);
    errorUrl.searchParams.set('error', 'token_exchange_failed');
    return NextResponse.redirect(errorUrl);
  }

  const tokenUrl = new URL('/api/auth/oauth2/token', getAppBaseURL());
  try {
    const tokenRes = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: 'portal',
        client_secret: portalClientSecret,
        redirect_uri: `${url.origin}/api/auth/callback`,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[Callback] Token 交换失败:', await tokenRes.text());
      const errorUrl = new URL('/login', url.origin);
      errorUrl.searchParams.set('error', 'token_exchange_failed');
      return NextResponse.redirect(errorUrl);
    }

    const tokens = await tokenRes.json();

    const isProduction = process.env.NODE_ENV === 'production';
    // 本地开发/E2E环境下，直连 HTTP 端口时必须降级为 secure: false，否则浏览器会拒绝写入
    const isLocal = request.headers.get('host')?.includes('localhost') || request.headers.get('host')?.includes('127.0.0.1');
    const secure = isProduction && !isLocal;
    const targetUrl = state || '/dashboard';

    const response = NextResponse.redirect(new URL(targetUrl, url.origin));

    // Set-Cookie: portal_jwt_token（OAuth 签发的 Access Token，含完整 claims）
    response.cookies.set(COOKIE_NAMES.JWT, tokens.access_token, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: tokens.expires_in || 3600,
    });

    // Set-Cookie: portal_refresh_token（如果有，路径隔离仅限 /api/auth/refresh）
    if (tokens.refresh_token) {
      response.cookies.set(COOKIE_NAMES.REFRESH, tokens.refresh_token, {
        path: '/api/auth/refresh',
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: TOKEN_TTL.REFRESH_TOKEN,
      });
    }

    return response;
  } catch (err) {
    console.error('[Callback] Token 交换异常:', err);
    const errorUrl = new URL('/login', url.origin);
    errorUrl.searchParams.set('error', 'token_exchange_failed');
    return NextResponse.redirect(errorUrl);
  }
}
