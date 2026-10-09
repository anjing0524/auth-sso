/**
 * 改密后会话终止的**双层覆盖**（真实 DB + mock Redis）
 *
 * ## 为什么需要它
 *
 * 密码变更（自助改密 / 管理员重置）的业务语义是"终止既有会话"。但此前三处编排
 * （`changeOwnPassword`、`reset-password` 端点、`revokeAfterPasswordReset`）
 * **都只撤销 Access Token 的 jti**，不撤 Refresh Token：
 *
 * | 编排 | 位置 |
 * |---|---|
 * | `changeOwnPassword` | `lib/account/change-password.ts` |
 * | 管理员重置端点 | `app/api/users/[id]/reset-password/route.ts` |
 * | `revokeAfterPasswordReset` | `lib/account/reset-password.ts`（Server Action 路径）|
 *
 * 后果：**攻击者用窃取的旧 RT 仍能换取新 AT**，旧会话从未真正终止——而
 * "重置密码踢出会话"恰恰是账号疑似失陷时的处置手段。
 *
 * 对照：`logout` 与 `revokeAllRefreshTokens` 都是双层撤销
 * （`revokeUserRefreshTokens` + `revokeUserAccessByUserId`）。
 *
 * @req B-USR-PW, H-SESS-004
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedAdminUser, seedTestUser, seedPortalClient } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { hashToken } from '@/lib/crypto';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: { mockRevokeAccess: vi.fn(async () => 0) },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/lib/session/revoke', () => ({
  revokeUserAccessByUserId: mocks.mockRevokeAccess,
  isJtiRevoked: vi.fn(async () => false),
  trackUserJti: vi.fn(async () => {}),
  revokeJti: vi.fn(async () => {}),
  revokeUserToken: vi.fn(async () => {}),
}));

import { revokeAfterPasswordReset } from '@/lib/account/reset-password';

const td = createTestDbHandle();
tdHolder.current = td;

const USER_A = '00000000-0000-4000-8000-000000000101';
const USER_B = '00000000-0000-4000-8000-000000000201';

async function seedRt(token: string, userId: string) {
  await td.db.insert(schema.refreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    userId,
    clientId: 'portal',
    scopes: 'openid offline_access',
    revoked: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    createdAt: new Date(),
  });
}

async function isRevoked(token: string): Promise<boolean | null> {
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
  mocks.mockRevokeAccess.mockResolvedValue(0);
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: [...seedAdminUser(), ...seedTestUser()],
    clients: seedPortalClient({ clientId: 'portal' }),
  });
});

describe('revokeAfterPasswordReset — 必须同时撤销 RT 与 AT', () => {
  it('**撤销目标用户的全部 Refresh Token**（否则旧 RT 仍可续期出 AT）', async () => {
    await seedRt('rt_target', USER_A);
    expect(await isRevoked('rt_target')).toBe(false);

    await revokeAfterPasswordReset(USER_A);

    expect(await isRevoked('rt_target')).toBe(true);
  });

  it('**同时撤销 Access Token jti**（双层都要执行，缺一层即闭环不完整）', async () => {
    await seedRt('rt_both_layers', USER_A);

    await revokeAfterPasswordReset(USER_A);

    expect(mocks.mockRevokeAccess).toHaveBeenCalledWith(USER_A);
  });

  it('**不波及其他用户的 RT**（重置一个账号不应影响他人会话）', async () => {
    await seedRt('rt_a', USER_A);
    await seedRt('rt_b', USER_B);

    await revokeAfterPasswordReset(USER_A);

    expect(await isRevoked('rt_a')).toBe(true);
    expect(await isRevoked('rt_b')).toBe(false);
  });

  it('**Redis 故障不得阻断 RT 撤销**（否决性操作不依赖缓存层）', async () => {
    await seedRt('rt_redis_down', USER_A);
    mocks.mockRevokeAccess.mockRejectedValue(new Error('redis unavailable'));

    // 不得抛出：密码已持久化，撤销是尽力而为
    await expect(revokeAfterPasswordReset(USER_A)).resolves.toBeUndefined();

    // 但否决性的 RT 撤销必须已经生效
    expect(await isRevoked('rt_redis_down')).toBe(true);
  });

  it('无 RT 的用户：不抛异常（幂等）', async () => {
    await expect(revokeAfterPasswordReset(USER_B)).resolves.toBeUndefined();
  });
});
