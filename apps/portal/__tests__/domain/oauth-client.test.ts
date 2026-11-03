/**
 * OAuth Client 校验的纯函数边界。
 *
 * Mutation 实测 oauth-client 72.73%：bcrypt 新格式、未配置 secret、
 * SHA-256 长度不等、redirect_uri 前缀伪造未覆盖。这里只补行为分支。
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  validateClientActive,
  validateClientSecret,
  validateRedirectUri,
} from '@/domain/auth/oauth-client';
import { InvalidClientError, InvalidRedirectUriError } from '@/domain/shared/errors';
import { hashPassword } from '@/domain/auth/password';

const SECRET = 'client-secret-for-test';
const SHA256 = createHash('sha256').update(SECRET).digest('hex');

describe('validateClientActive', () => {
  it('仅 ACTIVE 可用；缺失/停用都拒绝', () => {
    expect(() => validateClientActive({ status: 'ACTIVE' })).not.toThrow();
    expect(() => validateClientActive(undefined)).toThrow(InvalidClientError);
    expect(() => validateClientActive({ status: 'DISABLED' })).toThrow(InvalidClientError);
  });
});

describe('validateClientSecret', () => {
  it('未配置 secret → 拒绝', async () => {
    await expect(validateClientSecret({ clientSecret: null }, SECRET))
      .rejects.toThrow('客户端密钥未配置');
  });

  it('未提供 secret → 拒绝', async () => {
    await expect(validateClientSecret({ clientSecret: SHA256 }, ''))
      .rejects.toThrow('客户端密钥缺失');
    await expect(validateClientSecret({ clientSecret: SHA256 }, undefined))
      .rejects.toThrow('客户端密钥缺失');
  });

  it('SHA-256 遗留格式：匹配通过，不匹配拒绝', async () => {
    await expect(validateClientSecret({ clientSecret: SHA256 }, SECRET)).resolves.toBeUndefined();
    await expect(validateClientSecret({ clientSecret: SHA256 }, 'wrong-secret'))
      .rejects.toThrow('客户端密钥不匹配');
  });

  it('格式错误/长度不等 → 拒绝而不是崩溃', async () => {
    await expect(validateClientSecret({ clientSecret: 'not-a-64-hex' }, SECRET))
      .rejects.toThrow(InvalidClientError);
  });

  it('bcrypt 新格式：匹配通过，不匹配拒绝', async () => {
    const hash = await hashPassword(SECRET, { bcryptRounds: 4, passwordHistoryMax: 5 });
    await expect(validateClientSecret({ clientSecret: hash }, SECRET)).resolves.toBeUndefined();
    await expect(validateClientSecret({ clientSecret: hash }, 'wrong-secret'))
      .rejects.toThrow('客户端密钥不匹配');
  }, 30_000);
});

describe('validateRedirectUri', () => {
  it('精确匹配通过', () => {
    expect(() => validateRedirectUri(['https://app.example.com/cb'], 'https://app.example.com/cb'))
      .not.toThrow();
  });

  it('前缀/追加路径不得放行（开放重定向）', () => {
    const registered = ['https://app.example.com/cb'];
    expect(() => validateRedirectUri(registered, 'https://app.example.com/cb.evil.com'))
      .toThrow(InvalidRedirectUriError);
    expect(() => validateRedirectUri(registered, 'https://app.example.com/cb/extra'))
      .toThrow(InvalidRedirectUriError);
  });
});
