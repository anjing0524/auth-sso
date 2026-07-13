'use client';

/**
 * PKCE (Proof Key for Code Exchange) 工具函数
 *
 * OAuth 2.1 标准要求使用 PKCE (S256)，无论 public 还是 confidential client。
 *
 * ⚠️ 此模块使用浏览器专用 Web Crypto API（btoa、crypto.getRandomValues、crypto.subtle），
 * 仅可在客户端组件中使用，禁止在 Server Action / API Route / 服务端组件中 import。
 *
 * @module lib/auth/pkce
 */

/** base64url 编码（无 padding） */
function base64UrlEncode(buffer: Uint8Array): string {
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
