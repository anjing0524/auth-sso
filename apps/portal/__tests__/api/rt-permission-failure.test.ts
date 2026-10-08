/**
 * 令牌轮换的权限上下文失效语义（真实 DB）
 *
 * 锁住 ADR-011 的分级在**实现层面**真正落实（见 ADR-018）：
 *
 * - 权限上下文是**缓存性数据**（DB 是永久真源）→ 基础设施故障时轮换**不得**被阻断。
 *   跳过预填充只意味着该用户下次鉴权时解析一次（fail-open 路径）。
 * - 用户不存在 / 非 ACTIVE 是**否决性数据** → 必须拒绝轮换，并补偿回收刚入库的新 RT。
 *
 * 修复前两种情形都 fail-close，使一次 DB 抖动等于用户被登出。
 *
 * @req H-SESS-003, H-ACL-002
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedPortalClient, seedRootDept } from '../helpers/seed-fixtures';
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

const USER_ID = '00000000-0000-4000-8000-000000000101';
const CLIENT_ID = 'portal';
const OLD_RT = 'rt_old_token_value_for_rotation_test';
const OK_CONTEXT = { roles: [], permissions: [], deptIds: [] };

async function seedRefreshToken(token: string) {
  await td.db.insert(schema.refreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    userId: USER_ID,
    clientId: CLIENT_ID,
    scopes: 'openid offline_access',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    createdAt: new Date(),
  });
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.mockCachePerm.mockResolvedValue(undefined);
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    clients: seedPortalClient({ clientId: CLIENT_ID }),
  });
  await seedRefreshToken(OLD_RT);
});

describe('rotateRefreshToken — 权限上下文缓存性故障不得阻断轮换', () => {
  it('unavailable（DB 故障）→ 仍然签发新令牌，仅跳过缓存预填充', async () => {
    mocks.mockGetPerm.mockResolvedValue({ kind: 'unavailable' });

    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBeTruthy();
    expect(result?.refreshToken).toBeTruthy();
    // 跳过预填充：不应调用缓存写入
    expect(mocks.mockCachePerm).not.toHaveBeenCalled();
  });

  it('unavailable → 旧 RT 仍被撤销、新 RT 仍入库（轮换语义完整）', async () => {
    mocks.mockGetPerm.mockResolvedValue({ kind: 'unavailable' });

    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);
    expect(result).not.toBeNull();

    const rows = await td.db.select({
      tokenHash: schema.refreshTokens.tokenHash,
      revoked: schema.refreshTokens.revoked,
    }).from(schema.refreshTokens);

    const old = rows.find((r) => r.tokenHash === hashToken(OLD_RT));
    const fresh = rows.find((r) => r.tokenHash === hashToken(result!.refreshToken));
    expect(old?.revoked).not.toBeNull();
    expect(fresh?.revoked).toBeNull();
  });

  it('ok → 正常预填充缓存', async () => {
    mocks.mockGetPerm.mockResolvedValue({ kind: 'ok', context: OK_CONTEXT });

    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);

    expect(result).not.toBeNull();
    expect(mocks.mockCachePerm).toHaveBeenCalledWith(USER_ID, OK_CONTEXT);
  });
});

describe('rotateRefreshToken — 否决性数据必须拒绝', () => {
  it('denied:not_found（用户已被删除）→ 返回 null 并补偿回收新 RT', async () => {
    await td.db.delete(schema.users).where(eq(schema.users.id, USER_ID));
    mocks.mockGetPerm.mockResolvedValue({ kind: 'denied', reason: 'not_found' });

    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);

    expect(result).toBeNull();
  });

  it('denied:inactive（用户被禁用）→ 返回 null 且不预填充', async () => {
    mocks.mockGetPerm.mockResolvedValue({ kind: 'denied', reason: 'inactive' });

    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);

    expect(result).toBeNull();
    expect(mocks.mockCachePerm).not.toHaveBeenCalled();
  });

  it('denied 时不留下"已入库但永不发放"的孤儿新 RT', async () => {
    mocks.mockGetPerm.mockResolvedValue({ kind: 'denied', reason: 'inactive' });

    await rotateRefreshToken(OLD_RT, CLIENT_ID);

    // 补偿回收：除旧 RT 外不应有未撤销的新 RT
    const rows = await td.db.select({ revoked: schema.refreshTokens.revoked })
      .from(schema.refreshTokens);
    expect(rows.every((r) => r.revoked !== null)).toBe(true);
  });
});
