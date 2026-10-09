/**
 * Refresh Token 复用检测与家族撤销（真假两态，真实 DB）— RFC 9700 §4.14
 *
 * ## 为什么需要它
 *
 * `rotateRefreshToken` 有两个都会「撤销整个授权家族」的分支：
 *
 * | 分支 | 触发条件 | 此前是否被真实执行 |
 * |---|---|---|
 * | reuse | 提交的 RT 已被轮换（`revoked=true`）| **否** |
 * | sender 不匹配 | RT 不属于认证中的 client | 是（auth-refresh.test.ts 的 sender 绑定用例）|
 *
 * 复用检测是 RFC 9700 的核心防线：攻击者拿到旧 RT 后重放，服务端必须判定
 * "该 RT 已被轮换过 ⇒ 疑似泄露"，并撤销同 `(userId, clientId)` 家族的全部 RT。
 * 而 `oauth2-token.test.ts` 覆盖的是**授权码重放**（另一机制）且把
 * `revokeRefreshTokenFamily` 整体 mock 掉，故此分支此前**从未被真实执行**。
 *
 * ## 本文件的两条不变量
 *
 * 1. **成败两态都不得泄露可用的旧 RT**：轮换成功一次后，旧 RT 永不再次可用。
 * 2. **家族隔离**：撤销只作用于同 `(userId, clientId)`，不得波及其他 client。
 *
 * @req H-SESS-003, H-SESS-004
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedPortalClient, seedRootDept, seedTestUser } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { hashToken } from '@/lib/crypto';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: { mockGetPerm: vi.fn(), mockCachePerm: vi.fn(async () => {}) },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mocks.mockGetPerm,
  cacheUserPermissionContext: mocks.mockCachePerm,
}));

import { rotateRefreshToken } from '@/lib/auth/token';

const td = createTestDbHandle();
tdHolder.current = td;

const USER_A = '00000000-0000-4000-8000-000000000101';
const USER_B = '00000000-0000-4000-8000-000000000201';
const CLIENT_A = 'portal';
const CLIENT_B = 'other-app';

async function seedRt(opts: {
  token: string;
  userId?: string;
  clientId?: string;
  /** 撤销时间戳；null 表示未撤销（`refresh_tokens.revoked` 是 timestamp 列） */
  revokedAt?: Date | null;
  expiresAt?: Date;
}) {
  await td.db.insert(schema.refreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(opts.token),
    userId: opts.userId ?? USER_A,
    clientId: opts.clientId ?? CLIENT_A,
    scopes: 'openid offline_access',
    revoked: opts.revokedAt ?? null,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
    createdAt: new Date(),
  });
}

/** 按 hash 查一行 RT 是否已撤销（`revoked` 列非空即已撤销） */
async function isRevoked(token: string): Promise<boolean | null> {
  const rows = await td.db
    .select({ revoked: schema.refreshTokens.revoked })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, hashToken(token)))
    .limit(1);
  return rows.length === 0 ? null : rows[0]!.revoked !== null;
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.mockGetPerm.mockResolvedValue({ roles: [], permissions: [], deptIds: [] });
  mocks.mockCachePerm.mockResolvedValue(undefined);
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: [...seedAdminUser(), ...seedTestUser()],
    clients: [
      seedPortalClient({ clientId: CLIENT_A })[0]!,
      seedPortalClient({ clientId: CLIENT_B })[0]!,
    ],
  });
});

describe('rotateRefreshToken — 复用检测（RFC 9700 §4.14）', () => {
  it('**轮换后重放旧 RT：拒绝并撤销该家族全部 RT（含新签发的那个）**', async () => {
    const oldRt = 'rt_reuse_family_old';
    await seedRt({ token: oldRt });

    // 第一次：正常轮换
    const first = await rotateRefreshToken(oldRt, CLIENT_A);
    expect(first).not.toBeNull();
    const newRt = first!.refreshToken;

    // 旧 RT 已被撤销（轮换语义）
    expect(await isRevoked(oldRt)).toBe(true);

    // 第二次：重放同一个旧 RT —— 必须拒绝
    const replay = await rotateRefreshToken(oldRt, CLIENT_A);
    expect(replay).toBeNull();

    // 关键：家族级撤销必须级联到**合法的那个新 RT**
    // （攻击者重放说明旧 RT 泄露，则整条链都不可信）
    expect(await isRevoked(newRt)).toBe(true);
  });

  it('**家族撤销不得波及其他 client**（同用户、不同 client 的 RT 保持可用）', async () => {
    const userARt = 'rt_family_isolation_a';
    const otherClientRt = 'rt_family_isolation_b';
    await seedRt({ token: userARt, clientId: CLIENT_A });
    await seedRt({ token: otherClientRt, clientId: CLIENT_B });

    await rotateRefreshToken(userARt, CLIENT_A);
    await rotateRefreshToken(userARt, CLIENT_A); // 触发复用检测

    // 另一 client 的家族不受影响
    expect(await isRevoked(otherClientRt)).toBe(false);
    // 且它仍可正常轮换——证明"家族隔离"不是靠把该行也撤掉实现的
    const stillUsable = await rotateRefreshToken(otherClientRt, CLIENT_B);
    expect(stillUsable).not.toBeNull();
  });

  it('**家族撤销不得波及其他用户**（同 client、不同用户的 RT 保持可用）', async () => {
    const rtA = 'rt_user_isolation_a';
    const rtB = 'rt_user_isolation_b';
    await seedRt({ token: rtA, userId: USER_A });
    await seedRt({ token: rtB, userId: USER_B });

    await rotateRefreshToken(rtA, CLIENT_A);
    await rotateRefreshToken(rtA, CLIENT_A); // 触发复用检测

    expect(await isRevoked(rtB)).toBe(false);
    expect(await rotateRefreshToken(rtB, CLIENT_A)).not.toBeNull();
  });

  it('已撤销的 RT 被重放 → 拒绝，且不产生新的 RT 行', async () => {
    const rt = 'rt_already_revoked';
    await seedRt({ token: rt, revokedAt: new Date() });

    const before = await td.db.select().from(schema.refreshTokens);
    const result = await rotateRefreshToken(rt, CLIENT_A);
    const after = await td.db.select().from(schema.refreshTokens);

    expect(result).toBeNull();
    expect(after.length).toBe(before.length);
  });
});

describe('rotateRefreshToken — sender 绑定同为家族撤销（RFC 9700）', () => {
  it('**提交属于其他 client 的 RT：拒绝并撤销其家族**', async () => {
    const rtOfB = 'rt_sender_mismatch';
    await seedRt({ token: rtOfB, clientId: CLIENT_B });

    // 用 client A 的身份提交本属于 B 的 RT
    const result = await rotateRefreshToken(rtOfB, CLIENT_A);

    expect(result).toBeNull();
    // 视同泄露：该 RT 被撤销
    expect(await isRevoked(rtOfB)).toBe(true);
  });

  it('未传 expectedClientId 时不做 sender 校验（内部调用语义）', async () => {
    const rt = 'rt_no_sender_check';
    await seedRt({ token: rt, clientId: CLIENT_B });

    // 省略 clientId ⇒ 仅做轮换，不做 sender 绑定
    const result = await rotateRefreshToken(rt);
    expect(result).not.toBeNull();
  });
});

describe('rotateRefreshToken — 过期与不存在', () => {
  it('过期的 RT 返回 null，且不撤销家族（过期≠泄露）', async () => {
    const rt = 'rt_expired';
    await seedRt({ token: rt, expiresAt: new Date(Date.now() - 1000) });

    const result = await rotateRefreshToken(rt, CLIENT_A);
    expect(result).toBeNull();
    // 过期是自然生命周期终点，不应触发泄露响应
    expect(await isRevoked(rt)).toBe(false);
  });

  it('不存在的 RT 返回 null', async () => {
    await expect(rotateRefreshToken('rt_never_issued', CLIENT_A)).resolves.toBeNull();
  });
});

describe('家族撤销的完整性与幂等', () => {
  it('家族撤销覆盖同 (user, client) 的全部行，且对其他组合零影响', async () => {
    await seedRt({ token: 'rt_f1', userId: USER_A, clientId: CLIENT_A });
    await seedRt({ token: 'rt_f2', userId: USER_A, clientId: CLIENT_A });
    await seedRt({ token: 'rt_other_client', userId: USER_A, clientId: CLIENT_B });
    await seedRt({ token: 'rt_other_user', userId: USER_B, clientId: CLIENT_A });

    await rotateRefreshToken('rt_f1', CLIENT_A);
    await rotateRefreshToken('rt_f1', CLIENT_A); // 复用 ⇒ 撤销 (A, CLIENT_A) 家族

    const family = await td.db
      .select({ revoked: schema.refreshTokens.revoked })
      .from(schema.refreshTokens)
      .where(and(
        eq(schema.refreshTokens.userId, USER_A),
        eq(schema.refreshTokens.clientId, CLIENT_A),
      ));
    expect(family.length).toBeGreaterThanOrEqual(2);
    expect(family.every((r) => r.revoked !== null)).toBe(true);

    expect(await isRevoked('rt_other_client')).toBe(false);
    expect(await isRevoked('rt_other_user')).toBe(false);
  });

  it('重复触发复用检测是幂等的（不抛异常、状态不变）', async () => {
    const rt = 'rt_idempotent';
    await seedRt({ token: rt });
    await rotateRefreshToken(rt, CLIENT_A);

    await expect(rotateRefreshToken(rt, CLIENT_A)).resolves.toBeNull();
    await expect(rotateRefreshToken(rt, CLIENT_A)).resolves.toBeNull();
    expect(await isRevoked(rt)).toBe(true);
  });
});
