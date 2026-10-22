/**
 * PKCE S256 验证（纯函数，零框架依赖）
 *
 * 授权码本身的**有效性**判定不在此处（详见 ADR-017）：`used` / `expiresAt` /
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
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier)),
  );
  const expected = base64UrlToBytes(codeChallenge);

  if (!constantTimeEqual(digest, expected)) {
    throw new PKCEVerificationError();
  }
}

/** base64url → Uint8Array（无padding） */
function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 恒定时间字节比较。
 *
 * 与 `validateClientSecret` 的定时安全比较对齐；用累积 XOR 而非短路比较，
 * 使耗时与"第几个字节不同"无关。长度不等时立即返回 false——PKCE 的
 * code_challenge 长度由规范固定（S256 恒为 43 字符），长度本身不是秘密。
 *
 * 说明：PKCE 两侧都是 SHA-256 输出（均匀分布），且 code_challenge 随授权请求
 * 公开注册，故计时侧信道在此**不构成实际可利用风险**；这是纵深防御，
 * 不是修补某个已成立的漏洞。
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
