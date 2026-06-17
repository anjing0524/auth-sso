import 'server-only';

/**
 * OAuth HTTP 辅助函数（Server-only，与 Next.js 耦合）
 *
 * 在 Controller 中复用以减少错误重定向 URL 和 Cookie 清除的样板代码。
 *
 * @module lib/oauth-utils
 */
import { NextRequest, NextResponse } from 'next/server';

/**
 * 构建 OAuth 错误重定向响应 — 将错误信息作为 query params 拼接到 /oauth/error 页面
 * @param request - NextRequest（用于获取 origin）
 * @param errorCode - OAuth 错误码（如 invalid_client、invalid_grant）
 * @param message - 用户可读的错误描述
 * @param clientId - 可选的 client_id（便于错误页展示）
 * @returns 302 重定向到 /oauth/error 的 NextResponse
 */
export function buildOAuthErrorRedirect(
  request: NextRequest,
  errorCode: string,
  message: string,
  clientId?: string,
): NextResponse {
  const errorUrl = new URL('/oauth/error', new URL(request.url).origin);
  errorUrl.searchParams.set('error', errorCode);
  errorUrl.searchParams.set('message', message);
  if (clientId) errorUrl.searchParams.set('client_id', clientId);
  return NextResponse.redirect(errorUrl);
}

/**
 * 清除 login_session 临时凭证 Cookie（防止一次性凭证被滥用）
 * @param response - NextResponse 对象，会在此对象上设置清除 Cookie 的 Header
 */
export function clearLoginSessionCookie(response: NextResponse): void {
  const isProduction = process.env.NODE_ENV === 'production';
  response.cookies.set('login_session', '', {
    path: '/api/auth/oauth2/authorize',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 0,
  });
}

/** OAuth 授权请求参数（用于重定向到登录页时保留） */
export interface OAuthAuthorizeParams {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  nonce?: string;
  code_challenge: string;
  code_challenge_method: string;
}

/**
 * 构建「重定向到登录页」响应 — Session 无效时保留所有 OAuth 参数
 * @param appBaseUrl - 应用基础 URL（用于构建绝对路径）
 * @param params - OAuth 授权参数
 * @returns 302 重定向到 /login 的 NextResponse
 */
export function buildLoginRedirect(
  appBaseUrl: string,
  params: OAuthAuthorizeParams,
): NextResponse {
  const loginUrl = new URL('/login', appBaseUrl);
  loginUrl.searchParams.set('client_id', params.client_id);
  loginUrl.searchParams.set('redirect_uri', params.redirect_uri);
  loginUrl.searchParams.set('scope', params.scope);
  loginUrl.searchParams.set('state', params.state);
  if (params.nonce) loginUrl.searchParams.set('nonce', params.nonce);
  loginUrl.searchParams.set('code_challenge', params.code_challenge);
  loginUrl.searchParams.set('code_challenge_method', params.code_challenge_method);
  return NextResponse.redirect(loginUrl);
}
