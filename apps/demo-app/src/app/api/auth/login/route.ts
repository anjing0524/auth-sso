/**
 * 登录入口 API
 * GET /api/auth/login - 发起 OAuth 授权请求
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  oauthConfig,
  buildAuthorizationUrl,
  generateRandomString,
  generateCodeVerifier,
  generateCodeChallenge,
} from '@/lib/oauth';
import { saveOAuthState } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * GET /api/auth/login
 * 发起 OAuth 授权请求
 */
export async function GET(request: NextRequest) {
  try {
    // 生成 OAuth 参数
    const state = generateRandomString(32);
    const nonce = generateRandomString(32);
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // 获取 redirect 参数（登录后要跳转的目标页面）
    const redirect = request.nextUrl.searchParams.get('redirect') || '/';

    // 保存 OAuth 状态到 Cookie
    await saveOAuthState({
      state,
      nonce,
      codeVerifier,
      redirect,
      createdAt: Date.now(),
    });

    // 构建授权 URL
    const authUrl = buildAuthorizationUrl(state, codeChallenge, nonce);

    // 重定向到 IdP 授权页面
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('[DemoApp] Login Error:', error);
    return NextResponse.redirect(
      new URL('/?error=login_failed', oauthConfig.appUrl)
    );
  }
}