/**
 * domain/auth/ 纯函数单元测试
 *
 * 覆盖：login.ts, password.ts, oauth-code.ts, oauth-client.ts, oauth-authorize.ts
 * 纯业务逻辑，零 DB/Redis 依赖。
 *
 * @req DC-AUTH-001~004
 * @req H-AUTH-003, H-AUTH-004, H-AUTH-010, H-AUTH-011
 * @vitest-environment node
 */
import { Buffer } from 'node:buffer';
import { describe, it, expect } from 'vitest';
import { PKCEVerificationError } from '@/domain/shared/errors';
import { validateLoginCredentials } from '@/domain/auth/login';
import { hashPassword, verifyPassword } from '@/domain/auth/password';
import { validateAuthCodeRow, verifyPKCE } from '@/domain/auth/oauth-code';
import { validateClientActive, validateClientSecret, validateRedirectUri } from '@/domain/auth/oauth-client';
import { validateAuthorization } from '@/domain/auth/oauth-authorize';

// ======== login.ts ========

describe('validateLoginCredentials', () => {
  const baseUser = {
    id: 'user-1', username: 'admin', name: 'Admin',
    email: 'admin@test.com', avatarUrl: null,
    passwordHash: '$2a$10$hash', status: 'ACTIVE' as const,
  };

  it('ACTIVE 用户有密码哈希 → 不抛异常', () => {
    expect(() => validateLoginCredentials(baseUser)).not.toThrow();
  });

  it('LOCKED 状态 → 抛出 AccountStatusError', () => {
    expect(() => validateLoginCredentials({ ...baseUser, status: 'LOCKED' as const }))
      .toThrow('账号已被锁定');
  });

  it('DISABLED 状态 → 抛出 AccountStatusError', () => {
    expect(() => validateLoginCredentials({ ...baseUser, status: 'DISABLED' as const }))
      .toThrow('账号已被禁用');
  });

  it('DELETED 状态 → 抛出 AccountStatusError', () => {
    expect(() => validateLoginCredentials({ ...baseUser, status: 'DELETED' as const }))
      .toThrow('账号已注销');
  });

  it('无密码哈希 → 抛出 BusinessRuleViolationError', () => {
    expect(() => validateLoginCredentials({ ...baseUser, passwordHash: null }))
      .toThrow('账号未设置密码');
  });
});

// ======== password.ts ========

describe('password', () => {
  it('hashPassword → 返回 bcrypt 哈希字符串', async () => {
    const hash = await hashPassword('test123');
    expect(hash).toMatch(/^\$2[aby]\$\d+\$/);
  });

  it('verifyPassword → 正确密码返回 true', async () => {
    const hash = await hashPassword('securepass');
    expect(await verifyPassword('securepass', hash)).toBe(true);
  });

  it('verifyPassword → 错误密码返回 false', async () => {
    const hash = await hashPassword('securepass');
    expect(await verifyPassword('wrongpass', hash)).toBe(false);
  });
});

// ======== oauth-code.ts ========

describe('validateAuthCodeRow', () => {
  const now = new Date();
  const validRow = {
    used: false,
    expiresAt: new Date(now.getTime() + 60000),
    redirectUri: 'https://app.example.com/cb',
    codeChallenge: 'abc123',
    codeChallengeMethod: 'S256' as const,
  };

  it('有效授权码 → 不抛异常', () => {
    expect(() => validateAuthCodeRow(validRow, 'https://app.example.com/cb')).not.toThrow();
  });

  it('undefined → 抛出 InvalidGrantError', () => {
    expect(() => validateAuthCodeRow(undefined)).toThrow('无效的授权码');
  });

  it('used=true → 抛出 InvalidGrantError', () => {
    expect(() => validateAuthCodeRow({ ...validRow, used: true }))
      .toThrow('授权码已被使用');
  });

  it('已过期 → 抛出 InvalidGrantError', () => {
    expect(() => validateAuthCodeRow({ ...validRow, expiresAt: new Date(now.getTime() - 1000) }))
      .toThrow('授权码已过期');
  });

  it('redirect_uri 不匹配 → 抛出 InvalidGrantError', () => {
    expect(() => validateAuthCodeRow(validRow, 'https://other.example.com/cb'))
      .toThrow('redirect_uri 不匹配');
  });
});

describe('verifyPKCE', () => {
  it('正确 code_verifier → 无异常', async () => {
    const verifier = 'test-verifier-string';
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
    const challenge = Buffer.from(digest).toString('base64url');
    await expect(verifyPKCE(verifier, challenge)).resolves.toBeUndefined();
  });

  it('错误 code_verifier → 抛出 PKCEVerificationError', async () => {
    const verifier = 'test-verifier-string';
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode('other-verifier'));
    const challenge = Buffer.from(digest).toString('base64url');
    await expect(verifyPKCE(verifier, challenge)).rejects.toThrow(PKCEVerificationError);
  });
});

// ======== oauth-client.ts ========

describe('validateClientActive', () => {
  it('ACTIVE client → 不抛异常', () => {
    expect(() => validateClientActive({ status: 'ACTIVE' })).not.toThrow();
  });

  it('undefined → 抛出 InvalidClientError', () => {
    expect(() => validateClientActive(undefined)).toThrow('该应用系统已停用或不存在');
  });

  it('DISABLED client → 抛出 InvalidClientError', () => {
    expect(() => validateClientActive({ status: 'DISABLED' })).toThrow();
  });
});

// SHA-256 hash of 'my-secret' for v3.2 client secret hash comparison
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHash } = require('crypto');
const VALID_SECRET = 'my-secret';
const VALID_HASH = createHash('sha256').update(VALID_SECRET).digest('hex');

describe('validateClientSecret', () => {
  it('匹配的 secret → 不抛异常', () => {
    expect(() => validateClientSecret({ clientSecret: VALID_HASH }, VALID_SECRET)).not.toThrow();
  });

  it('不匹配的 secret → 抛出 InvalidClientError', () => {
    expect(() => validateClientSecret({ clientSecret: VALID_HASH }, 'wrong-secret'))
      .toThrow('客户端密钥不匹配');
  });

  it('无 secret 输入 → 抛出 InvalidClientError', () => {
    expect(() => validateClientSecret({ clientSecret: VALID_HASH }, undefined))
      .toThrow('客户端密钥缺失');
  });
});

describe('validateRedirectUri', () => {
  it('匹配的 redirect_uri → 不抛异常', () => {
    expect(() => validateRedirectUri(['https://a.example.com/cb'], 'https://a.example.com/cb')).not.toThrow();
  });

  it('不匹配 → 抛出 InvalidRedirectUriError', () => {
    expect(() => validateRedirectUri(['https://a.example.com/cb'], 'https://evil.example.com/cb')).toThrow();
  });
});

// ======== oauth-authorize.ts ========

describe('validateAuthorization', () => {
  const activeRole = {
    id: 'role-1', code: 'MEMBER', status: 'ACTIVE',
    clientIds: ['client-1'],
  };

  it('ACTIVE 用户 + 已绑定角色 → 允许', () => {
    const result = validateAuthorization({
      userId: 'user-1', clientId: 'client-1',
      status: 'ACTIVE', roles: [activeRole],
    });
    expect(result.allowed).toBe(true);
  });

  it('无角色 → 拒绝', () => {
    const result = validateAuthorization({
      userId: 'user-1', clientId: 'client-1',
      status: 'ACTIVE', roles: [],
    });
    expect(result.allowed).toBe(false);
  });

  it('DISABLED 用户 → 拒绝', () => {
    const result = validateAuthorization({
      userId: 'user-1', clientId: 'client-1',
      status: 'DISABLED', roles: [activeRole],
    });
    expect(result.allowed).toBe(false);
  });

  it('有角色但无 Client 绑定 → 拒绝', () => {
    const result = validateAuthorization({
      userId: 'user-1', clientId: 'client-2',
      status: 'ACTIVE', roles: [activeRole],
    });
    expect(result.allowed).toBe(false);
  });
});
