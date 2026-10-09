/**
 * 自助改密编排测试（真实 DB）
 *
 * `lib/account/change-password.ts` 是"领域操作"的编排层：bcrypt 比对/哈希、
 * 持久化、会话撤销（ADR-019 命名该操作的试点）。
 *
 * 锁住三条行为：
 * - 旧密码正确 → 落库新哈希与新历史，且旧哈希不再可用
 * - 旧密码错误 → 可判别失败，**不落库**
 * - 会话撤销失败 → **不阻断改密**（改密已持久化；撤销是尽力而为）
 *
 * @req FR-USR-10, NFR-SEC-13, NFR-SEC-15
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { hashPassword, verifyPassword } from '@/domain/auth/password';
import { hashToken } from '@/lib/crypto';
import { seedPortalClient } from '../helpers/seed-fixtures';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: { mockRevoke: vi.fn(async () => 0) },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/lib/session/revoke', () => ({
  revokeUserAccessByUserId: mocks.mockRevoke,
}));

import { changeOwnPassword } from '@/lib/account/change-password';

const td = createTestDbHandle();
tdHolder.current = td;

const USER_ID = '00000000-0000-4000-8000-000000000101';
const CURRENT = 'Current@123456';
const NEW = 'BrandNew@654321';

async function currentRow() {
  const [row] = await td.db.select({
    passwordHash: schema.users.passwordHash,
    passwordHistory: schema.users.passwordHistory,
  }).from(schema.users).where(eq(schema.users.id, USER_ID));
  return row;
}

/** 种一个未撤销的 Refresh Token（与该用户绑定） */
async function seedRefreshToken(token: string) {
  await td.db.insert(schema.refreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    userId: USER_ID,
    clientId: 'portal',
    scopes: 'openid offline_access',
    revoked: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    createdAt: new Date(),
  });
}

async function isRtRevoked(token: string): Promise<boolean | null> {
  const [row] = await td.db
    .select({ revoked: schema.refreshTokens.revoked })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, hashToken(token)));
  return row ? row.revoked !== null : null;
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.mockRevoke.mockResolvedValue(0);
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser({ passwordHash: await hashPassword(CURRENT) }),
    clients: seedPortalClient({ clientId: 'portal' }),
  });
});

describe('changeOwnPassword — 会话终止必须覆盖 Refresh Token', () => {
  /**
   * 密码变更的业务语义是"终止既有会话"。只撤销 Access Token 的 jti 是**不够**的：
   * Refresh Token 仍可换取新的 Access Token，攻击者用窃取的 RT 就能在改密后
   * 继续续期——旧会话实际上从未被终止。
   *
   * 对照：`logout` 与 `revokeAllRefreshTokens` 都是**双层撤销**
   * （`revokeUserRefreshTokens` + `revokeUserAccessByUserId`）。
   */
  it('**改密后该用户的 Refresh Token 必须被撤销**（否则旧 RT 仍可续期）', async () => {
    const oldRt = 'rt_should_be_revoked_on_password_change';
    await seedRefreshToken(oldRt);
    expect(await isRtRevoked(oldRt)).toBe(false);

    const result = await changeOwnPassword(USER_ID, CURRENT, NEW);
    expect(result.ok).toBe(true);

    expect(await isRtRevoked(oldRt)).toBe(true);
  });

  it('改密失败（旧密码错）→ 不得撤销 RT（未发生变更就不终止会话）', async () => {
    const rt = 'rt_must_survive_failed_change';
    await seedRefreshToken(rt);

    const result = await changeOwnPassword(USER_ID, 'WrongPassword@1', NEW);
    expect(result.ok).toBe(false);

    expect(await isRtRevoked(rt)).toBe(false);
  });
});

describe('changeOwnPassword', () => {
  it('旧密码正确 → 落库新哈希与新历史，旧密码失效', async () => {
    const before = await currentRow();

    const result = await changeOwnPassword(USER_ID, CURRENT, NEW);

    expect(result.ok).toBe(true);
    const after = await currentRow();
    expect(await verifyPassword(NEW, after!.passwordHash!)).toBe(true);
    expect(await verifyPassword(CURRENT, after!.passwordHash!)).toBe(false);
    // 旧哈希推入历史（NFR-SEC-15 的基础）
    expect(after!.passwordHistory).toContain(before!.passwordHash);
  });

  it('旧密码错误 → 可判别失败，且不落库', async () => {
    const before = await currentRow();

    const result = await changeOwnPassword(USER_ID, 'WrongPassword@1', NEW);

    expect(result).toEqual({ ok: false, reason: 'invalid_current_password' });
    const after = await currentRow();
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it('新密码命中密码历史 → 被领域判定拒绝（NFR-SEC-15），且不落库', async () => {
    // 先改一次，使 NEW 成为历史项
    await changeOwnPassword(USER_ID, CURRENT, NEW);
    const mid = await currentRow();

    // 再改回 CURRENT —— 它现在位于密码历史中 → 必须拒绝（NFR-SEC-15）
    await expect(changeOwnPassword(USER_ID, NEW, CURRENT)).rejects.toThrow(
      '新密码不能与最近使用过的密码相同',
    );

    const after = await currentRow();
    expect(after!.passwordHash).toBe(mid!.passwordHash);
  });

  it('用户不存在 → 返回 user_not_found（调用方据此 404，不与"密码错误"混淆）', async () => {
    const result = await changeOwnPassword(
      '00000000-0000-4000-8000-000000000999', CURRENT, NEW,
    );

    expect(result).toEqual({ ok: false, reason: 'user_not_found' });
  });

  it('成功时撤销该用户全部会话', async () => {
    await changeOwnPassword(USER_ID, CURRENT, NEW);

    expect(mocks.mockRevoke).toHaveBeenCalledWith(USER_ID);
  });

  it('会话撤销失败 → 不阻断改密（新密码仍然生效）', async () => {
    mocks.mockRevoke.mockRejectedValueOnce(new Error('Redis down'));

    const result = await changeOwnPassword(USER_ID, CURRENT, NEW);

    expect(result.ok).toBe(true);
    const after = await currentRow();
    expect(await verifyPassword(NEW, after!.passwordHash!)).toBe(true);
  });
});
