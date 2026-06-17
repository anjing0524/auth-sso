/**
 * PKCE (Proof Key for Code Exchange) 工具函数
 *
 * OAuth 2.1 标准要求使用 PKCE (S256)，无论 public 还是 confidential client。
 * 浏览器端使用 Web Crypto API，服务端可替换为 Node crypto。
 *
 * @module lib/auth/pkce
 */

/** base64url 编码（无 padding） */
export function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** 生成 PKCE code_verifier（32 字节随机数，base64url 编码） */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/** 从 code_verifier 生成 S256 code_challenge */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** 生成随机 token（默认 16 字节，用于 state/nonce） */
export function generateRandomToken(length: number = 16): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/** 生成随机 state 参数（16 字节） */
export function generateState(): string {
  return generateRandomToken(16);
}

/** 生成随机 nonce 参数（16 字节） */
export function generateNonce(): string {
  return generateRandomToken(16);
}
