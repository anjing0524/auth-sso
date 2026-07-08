/**
 * Portal OAuth Callback (GET /api/auth/callback)
 *
 * OAuth 2.1 Authorization Code 流程的最后一步（Portal 作为 OAuth Client）。
 * 接收 authorize 端点签发的 code → 校验 state(CSRF) + nonce(重放) → 内部调用 token 端点
 * 换取 Token → Set-Cookie → 清除 4 个一次性 Client Cookie → 302 回到 return_to。
 *
 * 安全要点：
 * - state：Cookie.oauth_state ↔ URL.query.state 一致性校验（CSRF 防护，US-H-AUTH-06/07）
 * - nonce：id_token.nonce ↔ Cookie.oauth_nonce 比对（OIDC 重放防护，US-H-AUTH-10）
 * - code_verifier：作为独立 body 字段传给 /token（OAuth 2.1 标准，非编码进 redirect_uri）
 * - return_to：经 safeRedirectPath 消毒防开放重定向
 *
 * @route GET /api/auth/callback
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseURL, getEnvConfig } from '@/lib/env';
import { COOKIE_NAMES, TOKEN_TTL } from '@auth-sso/contracts';
import { safeRedirectPath } from '@/lib/oauth-utils';
import { decodeJwtPayload } from '@/lib/session/jwt';

/** 构建登录页错误重定向 */
function errorRedirect(publicBase: string, errorCode: string): NextResponse {
  const errorUrl = new URL('/login', publicBase);
  errorUrl.searchParams.set('error', errorCode);
  return NextResponse.redirect(errorUrl);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  // 公网 base URL（给浏览器的重定向用），不能依赖 url.origin（Docker 下是容器内部 hostname）
  const publicBase = getAppBaseURL();

  if (!code || !stateParam) {
    return errorRedirect(publicBase, 'invalid_state');
  }

  // ① CSRF 校验：URL.state 必须等于 Cookie.oauth_state（US-H-AUTH-06/07）
  const cookieState = request.cookies.get(COOKIE_NAMES.OAUTH_STATE)?.value;
  if (!cookieState || cookieState !== stateParam) {
    return errorRedirect(publicBase, 'csrf_mismatch');
  }

  // ② PKCE code_verifier（HttpOnly Cookie，proxy.ts 写入）
  const codeVerifier = request.cookies.get(COOKIE_NAMES.PKCE_VERIFIER)?.value;
  if (!codeVerifier) {
    return errorRedirect(publicBase, 'invalid_state');
  }

  // ③ nonce（HttpOnly Cookie，scope 含 openid 时 proxy.ts 写入）
  const cookieNonce = request.cookies.get(COOKIE_NAMES.OAUTH_NONCE)?.value;

  // ④ 回跳路径（HttpOnly Cookie，proxy.ts 写入）
  const returnTo = request.cookies.get(COOKIE_NAMES.RETURN_TO)?.value;

  // 内部调用 token 端点：用 code + PKCE verifier 换 token
  const env = getEnvConfig();
  const portalClientSecret = env.PORTAL_CLIENT_SECRET;
  if (!portalClientSecret) {
    console.error('[Callback] 缺少 PORTAL_CLIENT_SECRET 环境变量');
    return errorRedirect(publicBase, 'token_exchange_failed');
  }
  const internalBase = process.env.PORTAL_INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;

  // redirect_uri 必须与 authorize 请求一致（不附加动态参数）
  const redirectUri = new URL('/api/auth/callback', publicBase).toString();

  const tokenUrl = new URL('/api/auth/oauth2/token', internalBase);
  try {
    const tokenRes = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: 'portal',
        client_secret: portalClientSecret,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[Callback] Token 交换失败:', await tokenRes.text());
      return errorRedirect(publicBase, 'token_exchange_failed');
    }

    const tokens = await tokenRes.json();

    // ⑤ nonce 校验：Portal 自登录（scope 含 openid）proxy.ts 始终生成 nonce，
    //    cookieNonce 缺失为异常（不应静默跳过）。
    //    id_token.nonce 必须等于 Cookie.oauth_nonce（US-H-AUTH-10）
    if (!cookieNonce) {
      return errorRedirect(publicBase, 'nonce_missing');
    }
    if (tokens.id_token) {
      const idTokenPayload = decodeJwtPayload(tokens.id_token);
      if (idTokenPayload?.nonce !== cookieNonce) {
        return errorRedirect(publicBase, 'nonce_mismatch');
      }
    }

    const secure = (process.env.NEXT_PUBLIC_APP_URL || '').startsWith('https://');
    // 回跳路径从 return_to Cookie 取（不再复用 state），经同源消毒防开放重定向
    const targetUrl = safeRedirectPath(returnTo) || '/dashboard';

    const response = NextResponse.redirect(new URL(targetUrl, publicBase));

    response.cookies.set(COOKIE_NAMES.JWT, tokens.access_token, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: tokens.expires_in || 3600,
    });

    // Set-Cookie: portal_refresh_token（Path=/ 以便 Gateway 在全路径读取静默续签）
    if (tokens.refresh_token) {
      response.cookies.set(COOKIE_NAMES.REFRESH, tokens.refresh_token, {
        path: '/',
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: TOKEN_TTL.REFRESH_TOKEN,
      });
    }

    // ⑥ 清除 4 个一次性 Client Cookie（pkce_verifier / oauth_state / oauth_nonce / return_to）
    const clearOpts = {
      path: '/api/auth/callback',
      httpOnly: true,
      secure,
      sameSite: 'lax' as const,
      maxAge: 0,
    };
    response.cookies.set(COOKIE_NAMES.PKCE_VERIFIER, '', clearOpts);
    response.cookies.set(COOKIE_NAMES.OAUTH_STATE, '', clearOpts);
    response.cookies.set(COOKIE_NAMES.OAUTH_NONCE, '', clearOpts);
    response.cookies.set(COOKIE_NAMES.RETURN_TO, '', clearOpts);

    return response;
  } catch (err) {
    console.error('[Callback] Token 交换异常:', err);
    return errorRedirect(publicBase, 'token_exchange_failed');
  }
}
