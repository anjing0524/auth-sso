import 'server-only';

/**
 * OAuth HTTP 辅助函数（Server-only，与 Next.js 耦合）
 *
 * 在 Controller 中复用以减少错误重定向 URL 和 Cookie 清除的样板代码。
 *
 * @module lib/oauth-utils
 */
import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAMES } from '@auth-sso/contracts';

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
  response.cookies.set(COOKIE_NAMES.LOGIN_SESSION, '', {
    path: '/api/auth/oauth2/authorize',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 0,
  });
}

/**
 * 校验登录后的返回路径是否为安全的同源相对路径
 *
 * Portal 自身 SSO 流程中，OAuth `state` 参数被复用为「登录后返回路径」。
 * 必须确保它指向应用内部页面，防止开放重定向（如 `//evil.com`、`https://evil.com`、
 * 反斜杠等协议相对 URL 经 `new URL(state, base)` 解析后跳离本站）。
 *
 * CSRF 保护由 PKCE 提供（OAuth 2.1 §7.6），返回路径同源校验是额外的纵深防御。
 *
 * @param target 候选返回路径（来自 state 参数）
 * @returns 经过消毒的安全路径；不安全时返回 null
 */
export function safeRedirectPath(target: string | null | undefined): string | null {
  if (!target) return null;
  // 必须以单个 / 开头；禁止 //、/\、协议相对/绝对 URL
  if (!/^\//.test(target) || /^\/{2,}/.test(target) || /^\/\\/.test(target)) return null;
  try {
    const resolved = new URL(target, 'http://localhost');
    // 解析后必须仍是同源相对路径（无 host、无协议）
    if (resolved.host !== 'localhost') return null;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return null;
  }
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
