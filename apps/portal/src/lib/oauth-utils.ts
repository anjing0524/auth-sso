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
import { getAppBaseURL } from '@/lib/env';

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
  const errorUrl = new URL('/oauth/error', getAppBaseURL());
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
 * 返回路径从 return_to Cookie 读取（由 proxy.ts 写入），
 * 必须确保它指向应用内部页面，防止开放重定向（如 `//evil.com`、`https://evil.com`、
 * 反斜杠等协议相对 URL 经 `new URL(target, base)` 解析后跳离本站）。
 *
 * @param target 候选返回路径（来自 return_to Cookie）
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

/**
 * 构建「重定向到登录页」响应 — 未登录时只传不透明的 session_id
 *
 * OAuth 授权参数（client_id/redirect_uri/code_challenge/state/nonce）已暂存到 Redis
 * （key=portal:auth_req:{sessionId}），不进入 /login URL，避免敏感参数泄露到浏览器历史
 * 和 Referer 头。
 *
 * @param appBaseUrl - 应用基础 URL（用于构建绝对路径）
 * @param sessionId - authorize 端点生成的不透明会话 ID
 * @returns 302 重定向到 /login?session_id={sessionId} 的 NextResponse
 */
export function buildLoginPageRedirect(
  appBaseUrl: string,
  sessionId: string,
): NextResponse {
  const loginUrl = new URL('/login', appBaseUrl);
  loginUrl.searchParams.set('session_id', sessionId);
  return NextResponse.redirect(loginUrl);
}
