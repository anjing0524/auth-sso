import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
} from '@/lib/crypto';

// 使用 Node.js runtime
export const runtime = 'nodejs';

/**
 * 发起 OIDC 授权码登录流程
 * 生成 PKCE Verifier/Challenge、OIDC State/Nonce 因子，并通过安全 Cookie 存入客户端，最后重定向至 IdP 授权端点。
 * 
 * @param request 客户端发起的 NextRequest 请求实例
 * @returns NextResponse 重定向响应，或错误 JSON
 */
export async function GET(request: NextRequest) {
  console.log('[Login] Initializing login flow...');
  try {
    const searchParams = request.nextUrl.searchParams;
    const redirect = searchParams.get('redirect') || '/';

    // 1. 生成 PKCE 参数 - 静态导入并使用全局 crypto 统一密码学方法，保障 DRY 原则
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    const nonce = generateNonce();

    // 2. 构建授权 URL
    const authUrl = buildAuthorizationUrl({
      codeChallenge,
      state,
      nonce,
    });

    console.log('[Login] Redirecting to:', authUrl);

    // 3. 创建重定向响应
    const response = NextResponse.redirect(authUrl);

    const stateData = {
      verifier: codeVerifier,
      nonce,
      redirect,
      createdAt: Date.now(),
    };

    // 4. 设置 Cookie
    response.cookies.set('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });

    response.cookies.set('oauth_state_data', JSON.stringify(stateData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });

    return response;
  } catch (error: unknown) {
    console.error('[Login] Fatal error during login initialization:', error);
    // 错误优雅脱敏并前台 JSON 契约化，捍卫前台安全防爆线，杜绝 information leak
    return NextResponse.json(
      { error: COMMON_ERRORS.INTERNAL_ERROR, message: '登录初始化失败，请稍后重试' },
      { status: 500 }
    );
  }
}

/**
 * 构建 OIDC 授权重定向 URL
 * 
 * @param params 授权所需的 state、nonce 和 PKCE challenge
 * @returns 完整的 IdP 授权重定向 URL 字符串
 */
function buildAuthorizationUrl(params: {
  codeChallenge: string;
  state: string;
  nonce: string;
}): string {
  // 核心修复：确保 idpUrl 干净且无换行符
  const cleanIdpUrl = (oauthConfig.idpUrl || '').trim();
  const url = new URL('/api/auth/oauth2/authorize', cleanIdpUrl);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oauthConfig.clientId);
  url.searchParams.set('redirect_uri', oauthConfig.redirectUri);
  url.searchParams.set('scope', (oauthConfig.scopes || []).join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('nonce', params.nonce);

  return url.toString();
}

