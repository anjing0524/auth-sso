/**
 * Portal 登录入口
 * 重定向到 IdP 进行 OAuth 授权
 */
import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';

// 使用 Node.js runtime 以支持 crypto 操作
export const runtime = 'nodejs';

/**
 * GET /api/auth/login
 * 发起 OAuth 授权流程
 */
export async function GET(request: NextRequest) {
  try {
    // 获取 redirect 参数（登录后要跳转的目标页面）
    const searchParams = request.nextUrl.searchParams;
    const redirect = searchParams.get('redirect') || '/';

    // 生成 PKCE 参数
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();
    const nonce = generateNonce();

    // 构建 state 数据（包含 PKCE verifier 和原始 redirect）
    const stateData = {
      verifier: codeVerifier,
      nonce,
      redirect,
      createdAt: Date.now(),
    };

    // 创建响应并设置 Cookie
    const response = NextResponse.redirect(
      buildAuthorizationUrl({
        codeChallenge,
        state,
        nonce,
      })
    );

    // 存储 state 和 PKCE verifier 到 Cookie（HttpOnly）
    response.cookies.set('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 分钟
      path: '/',
    });

    response.cookies.set('oauth_state_data', JSON.stringify(stateData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 分钟
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('[Login] Error:', error);
    return NextResponse.json(
      { error: 'login_failed', message: '登录初始化失败' },
      { status: 500 }
    );
  }
}

/**
 * 生成 PKCE code_verifier
 * 随机字符串，43-128 个字符
 */
function generateCodeVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  const randomValues = new Uint8Array(64);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    // Node.js 环境
    require('crypto').webcrypto.getRandomValues(randomValues);
  }
  for (let i = 0; i < 64; i++) {
    result += chars[randomValues[i]! % chars.length];
  }
  return result;
}

/**
 * 生成 code_challenge (S256)
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * 生成随机 state
 */
function generateState(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(32);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 32; i++) {
    result += chars[randomValues[i]! % chars.length];
  }
  return result;
}

/**
 * 生成随机 nonce
 */
function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(16);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 16; i++) {
    result += chars[randomValues[i]! % chars.length];
  }
  return result;
}

/**
 * Base64 URL 编码
 */
function base64UrlEncode(array: Uint8Array): string {
  const base64 = Buffer.from(array).toString('base64');
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * 构建授权 URL
 */
function buildAuthorizationUrl(params: {
  codeChallenge: string;
  state: string;
  nonce: string;
}): string {
  // Better Auth OIDC Provider 端点路径: /api/auth/oauth2/authorize
  const url = new URL('/api/auth/oauth2/authorize', oauthConfig.idpUrl);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oauthConfig.clientId);
  url.searchParams.set('redirect_uri', oauthConfig.redirectUri);
  url.searchParams.set('scope', oauthConfig.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('nonce', params.nonce);

  return url.toString();
}