/**
 * Customer Graph OAuth 客户端配置
 * 用于与 IdP 进行 OAuth 2.1 Authorization Code Flow with PKCE
 *
 * 注意：此文件包含纯函数，可在服务端和客户端使用
 * OAuth 流程的状态存储由各 route 处理：
 * - /api/auth/login - 发起登录，存储 state 到 Cookie
 * - /api/auth/callback - 处理回调，验证 state，创建 Session
 */

/**
 * OAuth 配置
 */
export const oauthConfig = {
  // IdP 配置
  idpUrl: (process.env['NEXT_PUBLIC_IDP_URL'] || 'http://localhost:4001').trim(),
  clientId: (process.env['NEXT_PUBLIC_CLIENT_ID'] || 'customer-graph').trim(),
  clientSecret: process.env['IDP_CLIENT_SECRET'],

  // 回调 URL
  redirectUri: (process.env['NEXT_PUBLIC_REDIRECT_URI'] || 'http://localhost:4003/api/auth/callback').trim(),

  // OAuth Scopes
  scopes: ['openid', 'profile', 'email', 'offline_access'],
};

/**
 * 生成 PKCE code_verifier
 * 随机字符串，43-128 个字符
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * 从 code_verifier 生成 code_challenge (S256)
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64 URL 编码
 */
function base64UrlEncode(array: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...array));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * 生成随机 state 参数
 */
export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * 生成随机 nonce 参数
 */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * 构建 OAuth 授权 URL
 */
export function buildAuthorizationUrl(params: {
  codeChallenge: string;
  state: string;
  nonce: string;
  redirectUri?: string;
}): string {
  const url = new URL('/api/auth/oauth2/authorize', oauthConfig.idpUrl);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oauthConfig.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri || oauthConfig.redirectUri);
  url.searchParams.set('scope', oauthConfig.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('nonce', params.nonce);

  return url.toString();
}

/**
 * 构建授权 URL 后的说明：
 *
 * 完整 OAuth 流程：
 * 1. 前端调用 /api/auth/login?redirect=/target-path
 * 2. Login route 生成 PKCE 参数，存储到 Cookie，重定向到 IdP
 * 3. IdP 认证后回调到 /api/auth/callback?code=...&state=...
 * 4. Callback route 验证 state，用 code 换 token，创建 Session
 * 5. 重定向到原始目标路径
 *
 * 前端使用：
 * - 检查登录状态：fetch('/api/auth/session')
 * - 发起登录：window.location.href = '/api/auth/login'
 * - 登出：window.location.href = '/api/auth/logout'
 */