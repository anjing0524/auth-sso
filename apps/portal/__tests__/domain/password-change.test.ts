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
  assertHasPassword,
  assertPasswordNotReused,
  nextPasswordHistory,
  type PasswordChangeState,
} from '@/domain/auth/password-change';
import { BusinessRuleViolationError } from '@/domain/shared/errors';
import { PASSWORD_HISTORY_MAX } from '@/domain/auth/password';

const HASH_A = 'hash-a';
const HASH_B = 'hash-b';

const withPassword: PasswordChangeState = { currentHash: HASH_A, history: [HASH_B] };
const noPassword: PasswordChangeState = { currentHash: null, history: null };

describe('assertHasPassword（自助路径的否决判据）', () => {
  it('有密码 → 通过', () => {
    const state: PasswordChangeState = { ...withPassword };
    expect(() => assertHasPassword(state)).not.toThrow();
  });

  it('未设置密码 → 拒绝（应走管理员重置流程）', () => {
    const state: PasswordChangeState = { ...noPassword };
    expect(() => assertHasPassword(state)).toThrow(BusinessRuleViolationError);
    expect(() => assertHasPassword({ ...noPassword } as PasswordChangeState)).toThrow('账号未设置密码');
  });

  it('是**断言函数**：通过后 currentHash 被收窄为非空（调用方无需空串哨兵）', () => {
    const state: PasswordChangeState = { ...withPassword };
    assertHasPassword(state);
    // 此行若 currentHash 仍是 `string | null` 就编不过——这正是删除 `?? ''` 哨兵的机制
    const hash: string = state.currentHash;
    expect(hash).toBe(HASH_A);
  });
});

describe('assertPasswordNotReused（两条路径共用）', () => {
  it('不复用 → 通过', () => {
    expect(() => assertPasswordNotReused(false)).not.toThrow();
  });

  it('新密码命中近期历史 → 拒绝（NFR-SEC-15）', () => {
    expect(() => assertPasswordNotReused(true)).toThrow('新密码不能与最近使用过的密码相同');
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

  it('**无旧哈希（账号首次设密码）→ 历史原样保留**：不抛错、不写入空串哨兵', () => {
    // 管理员重置正是"为从未设密码的账号设初始密码"的流程，故这里必须可计算
    expect(nextPasswordHistory(noPassword)).toEqual([]);
    expect(nextPasswordHistory({ currentHash: null, history: [HASH_B] })).toEqual([HASH_B]);
  });
});
