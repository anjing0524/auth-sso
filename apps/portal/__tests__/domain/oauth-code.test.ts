/**
 * PKCE S256 验证的边界。
 *
 * Mutation 实测 oauth-code 81.48%：长度不等、base64url 的 -/_ 映射没有覆盖；
 * 这些分支决定"错误的 challenge 是否会被当成正确"。
 */
import { Buffer } from 'node:buffer';
import { describe, it, expect } from 'vitest';
import { verifyPKCE } from '@/domain/auth/oauth-code';
import { PKCEVerificationError } from '@/domain/shared/errors';

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString('base64url');
}

describe('verifyPKCE', () => {
  it('正确 verifier/challenge → 通过', async () => {
    await expect(verifyPKCE('correct-verifier', await challengeFor('correct-verifier')))
      .resolves.toBeUndefined();
  });

  it('长度不等 → 拒绝（不进入恒定时间循环）', async () => {
    const challenge = await challengeFor('correct-verifier');
    await expect(verifyPKCE('correct-verifier', challenge.slice(0, -1)))
      .rejects.toThrow(PKCEVerificationError);
  });

  it('base64url 的 -/_ 映射正确', async () => {
    // 确定性寻找包含 base64url 特有字符的 digest，确保替换分支真正被执行。
    let verifier = '';
    let challenge = '';
    for (let i = 0; i < 10_000; i += 1) {
      const candidate = `verifier-${i}`;
      const value = await challengeFor(candidate);
      if (/[-_]/.test(value)) {
        verifier = candidate;
        challenge = value;
        break;
      }
    }
    expect(challenge).toMatch(/[-_]/);
    await expect(verifyPKCE(verifier, challenge)).resolves.toBeUndefined();
  });
});
