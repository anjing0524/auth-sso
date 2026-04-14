/**
 * Demo App OAuth 配置
 * 配置 IdP 连接信息
 */

export const oauthConfig = {
  // IdP 端点配置
  issuer: process.env.OAUTH_ISSUER || 'http://localhost:4001',
  authorizationEndpoint: process.env.OAUTH_AUTH_ENDPOINT || 'http://localhost:4001/api/auth/oauth2/authorize',
  tokenEndpoint: process.env.OAUTH_TOKEN_ENDPOINT || 'http://localhost:4001/api/auth/oauth2/token',
  userInfoEndpoint: process.env.OAUTH_USERINFO_ENDPOINT || 'http://localhost:4001/api/auth/oauth2/userinfo',
  jwksEndpoint: process.env.OAUTH_JWKS_ENDPOINT || 'http://localhost:4001/api/auth/oauth2/jwks',
  endSessionEndpoint: process.env.OAUTH_LOGOUT_ENDPOINT || 'http://localhost:4001/api/auth/sign-out',

  // Client 配置
  clientId: process.env.OAUTH_CLIENT_ID || 'cl_demo_h_-Tat_G',
  clientSecret: process.env.OAUTH_CLIENT_SECRET || 'Atyaa_cK0I2IWzvZwn02ScaidBfUhNod',
  redirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:4002/api/auth/callback',

  // OAuth 配置
  scopes: ['openid', 'profile', 'email'],

  // 本应用配置
  appUrl: process.env.APP_URL || 'http://localhost:4002',
};

/**
 * 生成随机字符串
 * @param length - 字符串长度
 * @returns 随机字符串
 */
export function generateRandomString(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const crypto = globalThis.crypto;
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

/**
 * 生成 PKCE code_verifier
 * @returns Base64 URL 编码的随机字符串
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  globalThis.crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * 从 code_verifier 生成 code_challenge
 * @param verifier - PKCE code verifier
 * @returns SHA256 哈希后的 code challenge
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Base64 URL 编码
 * @param buffer - 要编码的字节数组
 * @returns Base64 URL 编码字符串
 */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 构建 OAuth 授权 URL
 * @param state - OAuth state 参数
 * @param codeChallenge - PKCE code challenge
 * @param nonce - OpenID Connect nonce
 * @returns 授权 URL
 */
export function buildAuthorizationUrl(state: string, codeChallenge: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: oauthConfig.clientId,
    redirect_uri: oauthConfig.redirectUri,
    response_type: 'code',
    scope: oauthConfig.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce,
  });

  return `${oauthConfig.authorizationEndpoint}?${params.toString()}`;
}

/**
 * 构建 logout URL
 * @param postLogoutRedirectUri - 登出后的跳转地址
 * @returns 登出 URL
 */
export function buildLogoutUrl(postLogoutRedirectUri?: string): string {
  const params = new URLSearchParams();

  if (postLogoutRedirectUri) {
    params.set('post_logout_redirect_uri', postLogoutRedirectUri);
  }

  const queryString = params.toString();
  return queryString ? `${oauthConfig.endSessionEndpoint}?${queryString}` : oauthConfig.endSessionEndpoint;
}