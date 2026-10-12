/**
 * 令牌轮换的权限上下文失效语义（真实 DB + 真实 Redis）
 *
 * 锁住 ADR-011 的分级在**实现层面**真正落实（见 ADR-018）：
 *
 * - 权限上下文是**缓存性数据**（DB 是永久真源）→ 基础设施故障时轮换**不得**被阻断。
 *   跳过预填充只意味着该用户下次鉴权时解析一次（fail-open 路径）。
 * - 用户不存在 / 非 ACTIVE 是**否决性数据** → 必须拒绝轮换，并补偿回收刚入库的新 RT。
 *
 * ## 改造前（`#48`）
 *
 * `getUserPermissionContext` 与 `cacheUserPermissionContext` **都是替身**，于是三支
 * 语义全由 `mockResolvedValue({kind:...})` 决定：`denied:not_found` 用例甚至先删了
 * 真实 users 行、又同时把返回值 mock 成 not_found（真身从未参与判断）；
 * "正常预填充"只断言 `cacheUserPermissionContext` 被调用（A2 只断言调用）。
 *
 * 现在：**真身驱动真实 DB 状态**——删除 users 行即 `denied:not_found`，把 status
 * 改成非 ACTIVE 即 `denied:inactive`；预填充断言落在**真实 Redis 键**上，并用
 * "删掉 users 行后仍返回 ok" 来证明缓存命中（行为化）。
 *
 * 唯一保留的替身是 `unavailable`：真实 PostgreSQL 无法按需变为不可用，故用
 * **开关式故障注入**（注解见该 mock），其余情况一律走真身。
 *
 * @req H-SESS-003, H-ACL-002
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { REDIS_KEY_PREFIX, USER_LOCKED } from '@auth-sso/contracts';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedPortalClient, seedRootDept } from '../helpers/seed-fixtures';
import { seedSigningKeys } from '../helpers/seed-signing-keys';
import * as schema from '@/db/schema';
import { hashToken } from '@/lib/crypto';
import type * as permissionsModule from '@/lib/permissions';

const { faultHolder, tdHolder } = vi.hoisted(() => ({
  /** 故障注入开关：真实 PostgreSQL 无法按需变为不可用 */
  faultHolder: { forceUnavailable: false },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

// @allow-module-mock @/lib/permissions fault-injection: 真实 PostgreSQL 无法按需变为不可用（unavailable 是基础设施故障，不是数据状态）；开关关闭时该导出仍走真身，`cacheUserPermissionContext` 全程真实
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    getUserPermissionContext: (userId: string) =>
      faultHolder.forceUnavailable
        ? Promise.resolve({ kind: 'unavailable' } as const)
        : actual.getUserPermissionContext(userId),
  };
});

import { rotateRefreshToken } from '@/lib/auth/token';
import { getUserPermissionContext } from '@/lib/permissions';
import { getRedis } from '@/infrastructure/redis';

const td = createTestDbHandle();
tdHolder.current = td;

const USER_ID = '00000000-0000-4000-8000-000000000101';
const CLIENT_ID = 'portal';
const OLD_RT = 'rt_old_token_value_for_rotation_test';
const PERMISSION_CACHE_KEY = `${REDIS_KEY_PREFIX.USER_PERMS}${USER_ID}`;

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

async function selectRefreshTokens() {
  return td.db
    .select({ tokenHash: schema.refreshTokens.tokenHash, revoked: schema.refreshTokens.revoked })
    .from(schema.refreshTokens);
}

/** 把用户置为非 ACTIVE（真身的 `denied:inactive` 由真实数据状态驱动） */
async function deactivateUser(): Promise<void> {
  await td.db.update(schema.users).set({ status: USER_LOCKED }).where(eq(schema.users.id, USER_ID));
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  faultHolder.forceUnavailable = false;
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    clients: seedPortalClient({ clientId: CLIENT_ID }),
  });
  await seedSigningKeys(td);
  await seedRefreshToken(OLD_RT);
});

describe('rotateRefreshToken — 权限上下文缓存性故障不得阻断轮换', () => {
  it('unavailable（DB 故障）→ 仍然签发新令牌，且**没有**任何权限缓存被写入', async () => {
    faultHolder.forceUnavailable = true;

    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBeTruthy();
    expect(result?.refreshToken).toBeTruthy();
    // 行为化断言：跳过预填充 ⇔ 真实 Redis 里没有该用户的权限缓存键
    await expect(getRedis().get(PERMISSION_CACHE_KEY)).resolves.toBeNull();
  });

  it('unavailable → 旧 RT 仍被撤销、新 RT 仍入库（轮换语义完整）', async () => {
    faultHolder.forceUnavailable = true;

    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);
    expect(result).not.toBeNull();

    const rows = await selectRefreshTokens();
    const old = rows.find((r) => r.tokenHash === hashToken(OLD_RT));
    const fresh = rows.find((r) => r.tokenHash === hashToken(result!.refreshToken));
    expect(old?.revoked).not.toBeNull();
    expect(fresh?.revoked).toBeNull();
  });

  it('ok（真身读真实 DB）→ 权限缓存被真实填充（键里持有上下文）', async () => {
    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);

    expect(result).not.toBeNull();
    const cached = await getRedis().get(PERMISSION_CACHE_KEY);
    expect(cached).not.toBeNull();
    const ctx = JSON.parse(cached!) as { roles: unknown[]; permissions: unknown[] };
    expect(Array.isArray(ctx.roles)).toBe(true);
    expect(Array.isArray(ctx.permissions)).toBe(true);

    // 已知局限（实测得出，非猜测）：真身 `getUserPermissionContext` 的**两个**成功分支
    // 自身也会 `safeSetCache` 回写，因此本断言无法区分"轮换里的预填充写"与"读路径回写"。
    // 变异"把 cacheUserPermissionContext 改成不写"时本用例仍绿。该预填充在此路径上
    // 是**冗余**的，属生产代码观察，已在 #48 留档，不在本票改动范围。
  });

  it('**缓存命中**：预填充之后即使删掉 users 行，仍返回 kind=ok（行为化证据）', async () => {
    expect((await rotateRefreshToken(OLD_RT, CLIENT_ID))).not.toBeNull();

    // 删掉真源，只留缓存
    await td.db.delete(schema.users).where(eq(schema.users.id, USER_ID));

    const afterDelete = await getUserPermissionContext(USER_ID);

    expect(afterDelete.kind).toBe('ok');
  });
});

describe('rotateRefreshToken — 否决性数据必须拒绝（由真实数据状态驱动）', () => {
  it('denied:not_found（用户行已删除）→ 返回 null', async () => {
    await td.db.delete(schema.users).where(eq(schema.users.id, USER_ID));

    // 前提：真身确实把它判成 not_found（而不是靠 mock 声明）
    await expect(getUserPermissionContext(USER_ID)).resolves.toEqual({
      kind: 'denied',
      reason: 'not_found',
    });

    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);

    expect(result).toBeNull();
  });

  it('denied:inactive（用户被禁用）→ 返回 null 且不写权限缓存', async () => {
    await deactivateUser();

    await expect(getUserPermissionContext(USER_ID)).resolves.toEqual({
      kind: 'denied',
      reason: 'inactive',
    });

    const result = await rotateRefreshToken(OLD_RT, CLIENT_ID);

    expect(result).toBeNull();
    await expect(getRedis().get(PERMISSION_CACHE_KEY)).resolves.toBeNull();
  });

  it('denied 时不留下"已入库但永不发放"的孤儿新 RT', async () => {
    await deactivateUser();

    await rotateRefreshToken(OLD_RT, CLIENT_ID);

    // 补偿回收：除旧 RT 外不应有未撤销的新 RT
    const rows = await selectRefreshTokens();
    expect(rows.every((r) => r.revoked !== null)).toBe(true);
  });
});
