/**
 * OAuth 授权码校验 + PKCE 验证（纯函数，零框架依赖）
 *
 * Controller 负责 Drizzle 查询授权码行，传入这些纯函数做业务判断。
 *
 * @module domain/auth/oauth-code
 */
import { InvalidGrantError, PKCEVerificationError } from '@/domain/shared/errors';

/** 授权码行最小接口（Controller 从 Drizzle 查询后传入） */
export interface AuthCodeRow {
  used: boolean | null;
  expiresAt: Date;
  redirectUri: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
}

/**
 * 校验授权码行是否有效（未使用、未过期、redirect_uri 匹配）
 * @param row - Drizzle 查询结果（undefined 表示未找到）
 * @param redirectUri - 请求中的 redirect_uri（可选校验）
 * @throws InvalidGrantError 当授权码无效
 */
export function validateAuthCodeRow(
  row: AuthCodeRow | undefined,
  redirectUri?: string,
): asserts row is NonNullable<typeof row> {
  if (!row) {
    throw new InvalidGrantError('无效的授权码');
  }
  if (row.used) {
    throw new InvalidGrantError('授权码已被使用');
  }
  if (Temporal.Instant.compare(
    Temporal.Instant.fromEpochMilliseconds(row.expiresAt.getTime()),
    Temporal.Now.instant(),
  ) < 0) {
    throw new InvalidGrantError('授权码已过期');
  }
  if (redirectUri && row.redirectUri !== redirectUri) {
    throw new InvalidGrantError('redirect_uri 不匹配');
  }
}

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
