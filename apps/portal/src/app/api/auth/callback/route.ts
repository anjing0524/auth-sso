/**
 * OAuth 回调处理 (加固诊断版)
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import {
  createSession,
  setSessionCookie,
} from '@/lib/session';
import { decodeJwt } from 'jose';
import { logLoginEvent, getClientIP } from '@/lib/audit';
import { generateRequestId } from '@/lib/crypto';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

/**
 * GET /api/auth/callback
 * 处理身份提供端 (IdP) 返回的授权码和 State 状态，发起 Token 交换并创建 Portal 本地会话，实现 SSO 单点登录回调。
 * 
 * @param request 客户端发起的 NextRequest 回调请求实例
 * @returns NextResponse.redirect 重定向响应
 */
export async function GET(request: NextRequest) {
  // 使用全局 crypto 工具库生成的 RequestId 替代不安全的 Math.random，捍卫 DRY 与安全性
  const requestId = generateRequestId();
  console.log(`[Callback][${requestId}] 收到 OAuth 回调请求`);

  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code || !state) {
      console.warn(`[Callback][${requestId}] 参数缺失: code 或 state 不存在`);
      const loginUrl = new URL('/login', request.nextUrl.origin);
      loginUrl.searchParams.set('error', 'invalid_params');
      return NextResponse.redirect(loginUrl.toString());
    }

    const storedState = request.cookies.get('oauth_state')?.value;
    const stateDataStr = request.cookies.get('oauth_state_data')?.value;

    if (!storedState || !stateDataStr || state !== storedState) {
      console.error(`[Callback][${requestId}] State 状态校验失败`);
      const loginUrl = new URL('/login', request.nextUrl.origin);
      loginUrl.searchParams.set('error', 'invalid_state');
      return NextResponse.redirect(loginUrl.toString());
    }

    const stateData = JSON.parse(stateDataStr);
    
    // 发起 Token 交换
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

    let tokenResponse;
    try {
      tokenResponse = await fetch(tokenUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        cache: 'no-store',
      });
    } catch (fetchError: unknown) {
      const fetchErrorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(`[Callback][${requestId}] 网络通信异常:`, fetchErrorMessage);
      throw new Error(`Fetch failed: ${fetchErrorMessage}`);
    }

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error(`[Callback][${requestId}] IdP 响应异常 ${tokenResponse.status}:`, errorBody);
      throw new Error(`IdP Error ${tokenResponse.status}: ${errorBody}`);
    }

    const tokens = await tokenResponse.json();
    console.log(`[Callback][${requestId}] Token 交换成功`);

    // 1. 解码 ID Token 并校验 Nonce
    const decoded = decodeJwt(tokens.id_token);

    if (stateData.nonce) {
      if (decoded.nonce !== stateData.nonce) {
        console.error(`[Callback][${requestId}] Nonce 不匹配!`);
        const loginUrl = new URL('/login', request.nextUrl.origin);
        loginUrl.searchParams.set('error', 'invalid_nonce');
        return NextResponse.redirect(loginUrl.toString());
      }
    }

    // 2. 创建 Portal 会话
    const session = await createSession({
      userId: (decoded.sub as string) || (decoded.email as string) || 'unknown',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 3600,
    });

    // 3. 异步记录登录日志
    await logLoginEvent({
      userId: session.userId,
      username: (decoded.email as string) || (decoded.name as string) || session.userId,
      eventType: 'LOGIN_SUCCESS',
      ip: getClientIP(request),
      userAgent: request.headers.get('user-agent') || undefined,
    }).catch(err => {
      console.error(`[Callback][${requestId}] 记录登录审计日志失败:`, err);
    });

    // 4. 重定向至原页面或控制台首页
    const targetPath = stateData.redirect || '/dashboard';
    const redirectUrl = new URL(targetPath, request.url);
    
    console.log(`[Callback][${requestId}] 重定向跳转至: ${targetPath}`);
    const response = NextResponse.redirect(redirectUrl);
    
    setSessionCookie(response, session.id);
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_state_data');

    return response;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? (error.stack || 'No stack trace') : 'No stack trace';
    console.error(`[Callback][${requestId}] 回调流程崩溃: ${errorMessage}`, errorStack);
    
    // 安全防爆线：前台 URL 仅携带通用且安全的 internal_crash，物理性切断 details 和 stack 明文，防止服务器资产泄露
    const crashUrl = new URL('/login', request.nextUrl.origin);
    crashUrl.searchParams.set('error', 'internal_crash');
    return NextResponse.redirect(crashUrl.toString());
  }
}

