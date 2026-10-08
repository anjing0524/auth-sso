/**
 * PKCE S256 验证（纯函数，零框架依赖）
 *
 * 授权码本身的**有效性**判定不在此处（详见 ADR-021）：`used` / `expiresAt` /
 * `redirect_uri` 由 token 端点的**原子领取** SQL 一并施加（条件 UPDATE +
 * RETURNING），使"一次性使用"在并发下成立。此处只负责密码学验证。
 *
 * @module domain/auth/oauth-code
 */
import { PKCEVerificationError } from '@/domain/shared/errors';

/**
 * PKCE S256 验证：SHA256(code_verifier) 结果 base64url 编码后与 code_challenge 比对
 * @param codeVerifier - 客户端提交的 code_verifier
 * @param codeChallenge - 授权码签发时存储的 code_challenge
 * @throws PKCEVerificationError 当验证失败
 */
export async function verifyPKCE(codeVerifier: string, codeChallenge: string): Promise<void> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier));
  const bytes = new Uint8Array(digest);
  const binary = String.fromCharCode(...bytes);
  const challenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (challenge !== codeChallenge) {
    throw new PKCEVerificationError();
  }
}
