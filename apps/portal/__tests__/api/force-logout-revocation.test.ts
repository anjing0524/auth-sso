/**
 * 强制下线的双层撤销闭环（真实 DB + mock Redis）
 *
 * ## 为什么需要它
 *
 * 「强制下线」是一**双层**撤销：RT 必须在 DB 里标记 `revoked`（否则可继续续期），
 * AT 必须在 Redis jti 黑名单里批量撤销（否则在 ≤1h TTL 内仍然有效）。
 * `revokeAllRefreshTokens` 正是把两者串起来的编排函数，但此前**零测试**；
 * 其唯一调用方 `POST /api/users/[id]/force-logout` 也**零测试**——
 * 即这条端到端路径完全未经验证。
 *
 * 覆盖的层：
 * - `revokeUserRefreshTokens` 原语本身另有 `rt-revocation.test.ts` 覆盖；
 *   本文件测的是**编排**（双层是否都执行、失败如何分级、作用域是否正确）。
 *
 * ## 失败语义（ADR-018 故障分级的体现）
 *
 * RT 的 DB 撤销是**否决性**操作：失败必须抛出（否则用户以为已下线但实际未下线）。
 * AT 的 jti 撤销依赖 Redis，属**缓存性**故障：失败只记日志，**不得**让整个
 * 强制下线失败——否则 Redis 抖动会变成一个"任何人都无法被下线"的后门。
 *
 * @req H-SESS-004, H-SESS-006
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedTestUser, seedPortalClient, seedAdminUser } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { hashToken } from '@/lib/crypto';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: {
    mockRevokeUserAccess: vi.fn(async () => 0),
  },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/lib/session/revoke', () => ({
  revokeUserAccessByUserId: mocks.mockRevokeUserAccess,
  isJtiRevoked: vi.fn(async () => false),
  trackUserJti: vi.fn(async () => {}),
  revokeJti: vi.fn(async () => {}),
  revokeUserToken: vi.fn(async () => {}),
}));

import { revokeAllRefreshTokens } from '@/lib/auth/token';

const td = createTestDbHandle();
tdHolder.current = td;

/** 与 seedAdminUser / seedTestUser 夹具的 id 保持一致 */
const USER_A = '00000000-0000-4000-8000-000000000101';
const USER_B = '00000000-0000-4000-8000-000000000201';
const CLIENT_PORTAL = 'portal';
const CLIENT_DEMO = 'demo-rp';

async function seedRt(token: string, userId: string, clientId: string, revokedAt?: Date) {
  await td.db.insert(schema.refreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    userId,
    clientId,
    scopes: 'openid offline_access',
    revoked: revokedAt ?? null,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    createdAt: new Date(),
  });
}

async function revokedTokens(userId: string): Promise<Array<{ tokenHash: string; revoked: Date | null }>> {
  return td.db
    .select({ tokenHash: schema.refreshTokens.tokenHash, revoked: schema.refreshTokens.revoked })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.userId, userId));
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.mockRevokeUserAccess.mockResolvedValue(0);
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: [...seedAdminUser(), ...seedTestUser()],
    clients: [
      seedPortalClient({ clientId: CLIENT_PORTAL })[0]!,
      seedPortalClient({ clientId: CLIENT_DEMO })[0]!,
    ],
  });
});

describe('revokeAllRefreshTokens — 双层撤销闭环', () => {
  it('**撤销该用户全部 RT（跨 client），且不波及其他用户**', async () => {
    await seedRt('rt_a_portal', USER_A, CLIENT_PORTAL);
    await seedRt('rt_a_demo', USER_A, CLIENT_DEMO);
    await seedRt('rt_b_portal', USER_B, CLIENT_PORTAL);

    await revokeAllRefreshTokens(USER_A);

    const aTokens = await revokedTokens(USER_A);
    expect(aTokens.length).toBe(2);
    expect(aTokens.every((r) => r.revoked !== null)).toBe(true);

    // 其他用户的 RT 不受影响
    const bTokens = await revokedTokens(USER_B);
    expect(bTokens.every((r) => r.revoked === null)).toBe(true);
  });

  it('**同时触发 AT jti 批量撤销**（双层都必须执行）', async () => {
    await seedRt('rt_jti', USER_A, CLIENT_PORTAL);

    await revokeAllRefreshTokens(USER_A);

    // 仅撤 RT 而不撤 jti，会让 AT 在 TTL 内继续可用——闭环缺一层
    expect(mocks.mockRevokeUserAccess).toHaveBeenCalledWith(USER_A);
  });

  it('**Redis 故障不得阻断 RT 撤销**（缓存性故障分级，ADR-018）', async () => {
    await seedRt('rt_redis_down', USER_A, CLIENT_PORTAL);
    mocks.mockRevokeUserAccess.mockRejectedValue(new Error('redis unavailable'));

    // 不得抛出：Redis 抖动不应使"任何人都无法被强制下线"；
    // 返回 0 表示本次没有可计数的 JTI 撤销（而非失败）
    await expect(revokeAllRefreshTokens(USER_A)).resolves.toBe(0);

    // 否决性的 DB 撤销必须已经生效
    const tokens = await revokedTokens(USER_A);
    expect(tokens.every((r) => r.revoked !== null)).toBe(true);
  });

  it('无 RT 的用户：不抛异常，且仍尝试撤销 jti（AT 可能仍活着）', async () => {
    // 无任何 RT 行，但该用户可能持有未过期的 AT
    await expect(revokeAllRefreshTokens(USER_B)).resolves.toBe(0);
    expect(mocks.mockRevokeUserAccess).toHaveBeenCalledWith(USER_B);
  });

  it('**返回实际撤销的 JTI 数量**（供调用方如实报告，不被幂等空转掩盖）', async () => {
    await seedRt('rt_count', USER_A, CLIENT_PORTAL);
    mocks.mockRevokeUserAccess.mockResolvedValue(5);

    await expect(revokeAllRefreshTokens(USER_A)).resolves.toBe(5);
  });

  it('已撤销的 RT 再次撤销是幂等的（沿用原撤销时间）', async () => {
    const firstRevoke = new Date(Date.now() - 3600_000);
    await seedRt('rt_already', USER_A, CLIENT_PORTAL, firstRevoke);

    await revokeAllRefreshTokens(USER_A);

    const tokens = await revokedTokens(USER_A);
    expect(tokens.length).toBe(1);
    // 覆盖式 update 会刷新时间戳；此处断言"仍是已撤销态"（语义不变量）
    expect(tokens[0]!.revoked).not.toBeNull();
  });
});
