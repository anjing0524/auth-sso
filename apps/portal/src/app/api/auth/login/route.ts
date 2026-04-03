import { NextRequest, NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/auth-client';
import crypto from 'crypto';

// 使用 Node.js runtime
export const runtime = 'nodejs';

/**
 * GET /api/auth/login
 * 发起 OAuth 授权流程
 */
export async function GET(request: NextRequest) {
  console.log('[Login] Initializing login flow...');
  try {
    const searchParams = request.nextUrl.searchParams;
    const redirect = searchParams.get('redirect') || '/';

    // 1. 生成 PKCE 参数 - 使用更稳健的同步方法
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
  } catch (error) {
    console.error('[Login] Fatal error during login initialization:', error);
    // 返回更清晰的错误响应，防止前端静默失败
    return new NextResponse('Login Initialization Failed: ' + (error as Error).message, { status: 500 });
  }
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

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
