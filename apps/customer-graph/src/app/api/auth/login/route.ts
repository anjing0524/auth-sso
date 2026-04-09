/**
 * OAuth 登录发起
 * 生成 PKCE 参数，存储到 Cookie，重定向到 IdP
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateCodeVerifier, generateCodeChallenge, generateState, generateNonce, buildAuthorizationUrl } from '@/lib/auth-client';

export const runtime = 'nodejs';

/**
 * GET /api/auth/login
 * 发起 OAuth 登录流程
 */
export async function GET(request: NextRequest) {
  try {
    // 获取重定向目标
    const redirect = request.nextUrl.searchParams.get('redirect') || '/';

    // 生成 PKCE 参数
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();
    const nonce = generateNonce();

    // 构建 state 数据 (包含 verifier、nonce、redirect 目标)
    const stateData = {
      verifier: codeVerifier,
      nonce,
      redirect,
      createdAt: Date.now(),
    };

    // 构建授权 URL
    const authUrl = buildAuthorizationUrl({ codeChallenge, state, nonce });

    // 创建响应并设置临时 Cookie
    const response = NextResponse.redirect(authUrl);

    // 存储 state 到 Cookie (HttpOnly，防止 XSS)
    response.cookies.set('oauth_state', state, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600, // 10 分钟
      secure: process.env.NODE_ENV === 'production',
    });

    // 存储 state 数据到 Cookie
    response.cookies.set('oauth_state_data', JSON.stringify(stateData), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600, // 10 分钟
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch (error) {
    console.error('[Login-CG] Error:', error);
    return NextResponse.redirect(
      new URL('/login?error=login_failed', request.url)
    );
  }
}