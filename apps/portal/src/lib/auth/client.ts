/**
 * Portal OAuth 客户端配置 & PKCE 工具集（浏览器端 Client Component 专用）
 *
 * ⚠️ 此文件用于客户端组件，勿添加 'server-only'。
 *
 * @module lib/auth/client
 */
import { createAuthClient } from 'better-auth/react';

/** Portal 默认基础 URL（与 gateway 端口 4100 对齐） */
const DEFAULT_APP_URL = 'http://localhost:4100';

/** Better Auth 浏览器端客户端实例 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL,
});

/** OAuth 配置（Portal 自身即是 OIDC Provider） */
export const oauthConfig = {
  idpUrl: (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).trim(),
  clientId: (process.env.NEXT_PUBLIC_CLIENT_ID || 'portal').trim(),
  clientSecret: process.env.IDP_CLIENT_SECRET,
  redirectUri: (process.env.NEXT_PUBLIC_REDIRECT_URI || `${DEFAULT_APP_URL}/api/auth/callback`).trim(),
  scopes: ['openid', 'profile', 'email', 'offline_access'],
};

function base64UrlEncode(array: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...array));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** 生成 PKCE code_verifier */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/** 从 code_verifier 生成 code_challenge (S256) */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** 生成随机 state 参数 */
export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/** 生成随机 nonce 参数 */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/** 构建 OAuth 授权 URL */
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
