/**
 * Portal OAuth 客户端配置
 * 用于与 IdP 进行 OAuth 2.1 Authorization Code Flow with PKCE
 */
import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth 客户端实例
 * 用于客户端组件中的认证操作
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000',
});

/**
 * OAuth 配置
 */
export const oauthConfig = {
  // IdP 配置
  idpUrl: process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4001',
  clientId: process.env.NEXT_PUBLIC_CLIENT_ID || 'portal',
  clientSecret: process.env.IDP_CLIENT_SECRET,

  // 回调 URL
  redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:4000/api/auth/callback',

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