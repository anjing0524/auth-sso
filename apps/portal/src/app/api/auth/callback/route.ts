/**
 * OAuth 回调处理（JWT Cookie 无状态版）
 *
 * 登录成功后不再创建 Redis Session，而是将 IdP 签发的 JWT Access Token 和
 * Refresh Token 分别写入 HttpOnly Cookie，实现真正的去中心化无状态会话。
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import { setJwtCookies } from '@/lib/session';
import { decodeJwt } from 'jose';
import { logLoginEvent, getClientIP } from '@/lib/audit';
import { generateRequestId } from '@/lib/crypto';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/auth/callback
 * 处理 IdP 返回的授权码，发起 Token 交换并将 JWT 写入 HttpOnly Cookie。
 *
 * @param request 客户端发起的 NextRequest 回调请求实例
 * @returns NextResponse.redirect 重定向响应
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  console.log(`[Callback][${requestId}] 收到 OAuth 回调请求`);

  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      console.warn(`[Callback][${requestId}] 参数缺失: code 或 state 不存在`);
      return redirectToLogin(request, 'invalid_params');
    }

    // 校验 State 防 CSRF
    const storedState = request.cookies.get('oauth_state')?.value;
    const stateDataStr = request.cookies.get('oauth_state_data')?.value;

    if (!storedState || !stateDataStr || state !== storedState) {
      console.error(`[Callback][${requestId}] State 状态校验失败`);
      return redirectToLogin(request, 'invalid_state');
    }

    const stateData = JSON.parse(stateDataStr);

    // Back-Channel Token 交换
    const tokenUrl = new URL('/api/auth/oauth2/token', oauthConfig.idpUrl);
    const clientSecret = (process.env.IDP_CLIENT_SECRET || '').trim();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauthConfig.redirectUri,
      client_id: oauthConfig.clientId,
      code_verifier: stateData.verifier,
      client_secret: clientSecret,
    });

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(tokenUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        cache: 'no-store',
      });
    } catch (fetchError: unknown) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(`[Callback][${requestId}] 网络通信异常:`, msg);
      throw new Error(`Fetch failed: ${msg}`);
    }

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error(`[Callback][${requestId}] IdP 响应异常 ${tokenResponse.status}:`, errorBody);
      throw new Error(`IdP Error ${tokenResponse.status}: ${errorBody}`);
    }

    const tokens = await tokenResponse.json();
    console.log(`[Callback][${requestId}] Token 交换成功`);

    // 解码 ID Token 校验 Nonce（防重放）
    const decoded = decodeJwt(tokens.id_token);
    if (stateData.nonce && decoded.nonce !== stateData.nonce) {
      console.error(`[Callback][${requestId}] Nonce 不匹配!`);
      return redirectToLogin(request, 'invalid_nonce');
    }

    const userId = (decoded.sub as string) || (decoded.email as string) || 'unknown';

    // 异步记录登录审计日志（不阻塞主流程）
    logLoginEvent({
      userId,
      username: (decoded.email as string) || (decoded.name as string) || userId,
      eventType: 'LOGIN_SUCCESS',
      ip: getClientIP(request),
      userAgent: request.headers.get('user-agent') || undefined,
    }).catch(err => {
      console.error(`[Callback][${requestId}] 登录审计日志记录失败:`, err);
    });

    // 重定向至目标页面
    const targetPath = stateData.redirect || '/dashboard';
    const redirectUrl = new URL(targetPath, request.url);

    console.log(`[Callback][${requestId}] 登录成功，重定向至: ${targetPath}`);
    const response = NextResponse.redirect(redirectUrl);

    // ✅ 核心改变：直接将 JWT 写入 HttpOnly Cookie，不再创建 Redis Session
    setJwtCookies(
      response,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in || 3600
    );

    // 清理 PKCE/State 临时 Cookie
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_state_data');

    return response;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? (error.stack || 'No stack') : 'No stack';
    console.error(`[Callback][${requestId}] 回调流程崩溃: ${errorMessage}`, errorStack);
    return redirectToLogin(request, 'internal_crash');
  }
}

/**
 * 构建登录页重定向响应（统一脱敏错误信息）
 *
 * @param request 原始请求对象
 * @param error 错误标识（不包含敏感信息）
 */
function redirectToLogin(request: NextRequest, error: string): NextResponse {
  const crashUrl = new URL('/login', request.nextUrl.origin);
  crashUrl.searchParams.set('error', error);
  return NextResponse.redirect(crashUrl.toString());
}
