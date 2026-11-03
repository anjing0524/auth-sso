/**
 * password.ts 的纯函数边界（不连 DB/Redis）。
 *
 * Mutation 发现：isPasswordReused / pushPasswordHistory / DUMMY 哈希原先没有直接覆盖，
 * oauth/密码域 mutation score 被这些空洞拉低。本文件只补领域边界，不重复 auth.test.ts。
 */
import { describe, it, expect, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  DUMMY_PASSWORD_HASH,
  PASSWORD_HISTORY_MAX,
  hashPassword,
  verifyPasswordForUnknownUser,
  isPasswordReused,
  pushPasswordHistory,
} from '@/domain/auth/password';

const CONFIG = { bcryptRounds: 4, passwordHistoryMax: 2 } as const;

describe('password history', () => {
  it('无历史 → 不复用', async () => {
    await expect(isPasswordReused('next-password', null)).resolves.toBe(false);
    await expect(isPasswordReused('next-password', [])).resolves.toBe(false);
  });

  it('命中历史 → 复用；未命中 → 不复用', async () => {
    const oldHash = await hashPassword('old-password', CONFIG);
    await expect(isPasswordReused('old-password', [oldHash])).resolves.toBe(true);
    await expect(isPasswordReused('new-password', [oldHash])).resolves.toBe(false);
  });

  it('多历史中任一命中即复用（不是 every）', async () => {
    const oldHash = await hashPassword('old-password', CONFIG);
    const otherHash = await hashPassword('other-password', CONFIG);
    await expect(isPasswordReused('old-password', [oldHash, otherHash])).resolves.toBe(true);
  });

  it('push 保留最新在前，并按配置截断', () => {
    const next = pushPasswordHistory(['old-2', 'old-3'], 'old-1', CONFIG);
    expect(next).toEqual(['old-1', 'old-2']);
    expect(pushPasswordHistory(null, 'first', CONFIG)).toEqual(['first']);
  });

  it('默认历史上限为 5', () => {
    expect(PASSWORD_HISTORY_MAX).toBe(5);
  });

  it('未注入 config 时使用默认 bcrypt rounds', async () => {
    const hash = await hashPassword('default-rounds');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  }, 30_000);
});

describe('unknown-user timing hash', () => {
  it('是合法 bcrypt hash，且真正执行等价比对', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$\d{2}\$/);
    const compare = vi.spyOn(bcrypt, 'compare');
    await expect(verifyPasswordForUnknownUser('anything')).resolves.toBeUndefined();
    expect(compare).toHaveBeenCalledWith('anything', DUMMY_PASSWORD_HASH);
    compare.mockRestore();
  });
});
