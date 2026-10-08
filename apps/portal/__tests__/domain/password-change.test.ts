/**
 * 自助改密领域判定测试
 *
 * `domain/auth/password-change.ts` 是纯同步规则（无 bcrypt / DB），
 * 可直接穷举。它与 `domain/auth/login.ts` 同构：判定在 domain、
 * I/O 在 `lib/account/change-password.ts`（ADR-019）。
 *
 * @req FR-USR-10, NFR-SEC-15
 */
import { describe, it, expect } from 'vitest';
import {
  assertPasswordChangeAllowed,
  nextPasswordHistory,
  type PasswordChangeState,
} from '@/domain/auth/password-change';
import { BusinessRuleViolationError } from '@/domain/shared/errors';
import { PASSWORD_HISTORY_MAX } from '@/domain/auth/password';

const HASH_A = 'hash-a';
const HASH_B = 'hash-b';

const withPassword: PasswordChangeState = { currentHash: HASH_A, history: [HASH_B] };
const noPassword: PasswordChangeState = { currentHash: null, history: null };

describe('assertPasswordChangeAllowed', () => {
  it('有密码且不复用 → 通过', () => {
    expect(() => assertPasswordChangeAllowed(withPassword, {
      newPassword: 'NewPassw0rd!',
      reusesRecentPassword: false,
    })).not.toThrow();
  });

  it('未设置密码 → 拒绝（应走管理员重置流程）', () => {
    expect(() => assertPasswordChangeAllowed(noPassword, {
      newPassword: 'NewPassw0rd!',
      reusesRecentPassword: false,
    })).toThrow(BusinessRuleViolationError);
  });

  it('新密码命中近期历史 → 拒绝（NFR-SEC-15）', () => {
    expect(() => assertPasswordChangeAllowed(withPassword, {
      newPassword: 'Reused0ld!',
      reusesRecentPassword: true,
    })).toThrow('新密码不能与最近使用过的密码相同');
  });

  it('未设置密码优先于复用判定（两者同时成立时抛前者）', () => {
    expect(() => assertPasswordChangeAllowed(noPassword, {
      newPassword: 'x',
      reusesRecentPassword: true,
    })).toThrow('账号未设置密码');
  });
});

describe('nextPasswordHistory', () => {
  it('旧哈希入列并置于首位', () => {
    expect(nextPasswordHistory(withPassword)).toEqual([HASH_A, HASH_B]);
  });

  it('无历史时只含旧哈希', () => {
    expect(nextPasswordHistory({ currentHash: HASH_A, history: null })).toEqual([HASH_A]);
  });

  it('按 HISTORY_MAX 截断', () => {
    const longHistory = Array.from({ length: PASSWORD_HISTORY_MAX + 3 }, (_, i) => `h${i}`);
    const next = nextPasswordHistory({ currentHash: HASH_A, history: longHistory });
    expect(next).toHaveLength(PASSWORD_HISTORY_MAX);
    expect(next[0]).toBe(HASH_A);
  });

  it('未设置密码 → 拒绝（与 assert 同判据）', () => {
    expect(() => nextPasswordHistory(noPassword)).toThrow(BusinessRuleViolationError);
  });
});
