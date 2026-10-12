/**
 * 批量刷新权限缓存的**结果可判别性**（真实 DB + mock Redis 边界）
 *
 * ## 为什么需要它
 *
 * `refreshUsersPermissionCache` 用于"角色/权限/部门变更后立即同步一批用户的缓存"，
 * 由 `settleUserBatches` 按**操作的返回结果**统计成败。
 *
 * ADR-018 把 `getUserPermissionContext` 由 `| null` 改为分级联合
 * `ok | denied(not_found|inactive) | unavailable` 之后，`refreshUserPermissionCache`
 * 的调用点没有同步：`if (ctx)` 是 `| null` 时代的写法，而分级联合**永远是对象
 * （真值）**，于是 DB 故障（`kind: 'unavailable'`）照样 `return { ok: true }`——
 * `failed` 只剩 Redis 抛错一条路径，调用方在 DB 抖动时被告知"全部刷新成功"。
 * 这与本仓库已修的 `revokeUsersAccessByUserId`、`revokeAllRefreshTokens` 属
 * **同一形态的第四次出现**：把"永不失败的调用"当作失败信号。
 *
 * ## 为什么此前隐形（普查 N2）
 *
 * 旧版本用 `vi.mock('@/infrastructure/db', () => ({ db: {}, schema: {} }))`
 * 制造"DB 必然抛错"的世界，却断言 `succeeded === 2`——断言与它自己的世界相反。
 * 本文件改用**真实 PostgreSQL**：成功路径由真实用户行驱动（不再由 mock 声称），
 * 故障路径用**真实关闭的连接**注入（不再手写假 DB 对象）。
 *
 * @req H-PERM-004, H-SESS-004
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedTestUser, seedRootDept } from '../helpers/seed-fixtures';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: {
    /** del 的替身：决定缓存清除是否成功（失败即模拟 Redis 故障） */
    mockDel: vi.fn(async (..._keys: string[]) => 1),
    mockGet: vi.fn(async (_key: string) => null as string | null),
    mockSetex: vi.fn(async (_key: string, _seconds: number, _value: string) => 'OK' as const),
  },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

// 基础设施边界：Redis 用替身（本文件的被测对象是**计数语义**，不是 Redis 行为）
vi.mock('@/infrastructure/redis', () => ({
  getRedis: () => ({
    del: mocks.mockDel,
    get: mocks.mockGet,
    setex: mocks.mockSetex,
  }),
}));

// 真实 PostgreSQL：透传到测试句柄（与多数 API 测试同体例）
vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

import { refreshUsersPermissionCache } from '@/lib/permissions';

const USER_A = '00000000-0000-4000-8000-000000000101';
const USER_B = '00000000-0000-4000-8000-000000000201';

const td = createTestDbHandle();
tdHolder.current = td;

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.mockDel.mockResolvedValue(1);
  mocks.mockGet.mockResolvedValue(null);
  mocks.mockSetex.mockResolvedValue('OK');
  tdHolder.current = td;
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: [...seedAdminUser(), ...seedTestUser()],
  });
});

/** 注入真实 DB 故障：连上再关掉，使后续查询走真实错误路径而非假对象 */
async function injectDatabaseFailure() {
  const broken = createTestDbHandle();
  await broken.connect();
  await broken.close();
  tdHolder.current = broken;
}

describe('refreshUsersPermissionCache — 成败必须可判别', () => {
  it('全部成功 → succeeded 等于用户数、failed 为 0，且缓存确实被回写', async () => {
    const result = await refreshUsersPermissionCache([USER_A, USER_B]);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    // 成功路径的真实副作用：两个用户各自的 :ok 上下文被写入缓存
    expect(mocks.mockSetex).toHaveBeenCalledTimes(2);
  });

  it('**DB 故障 → failed 必须等于用户数**（旧实现把 unavailable 计成成功）', async () => {
    await injectDatabaseFailure();

    const result = await refreshUsersPermissionCache([USER_A, USER_B]);

    expect(result.failed).toBe(2);
    expect(result.succeeded).toBe(0);
  });

  it('**Redis 故障 → failed 必须等于用户数**（Redis 抛错路径）', async () => {
    mocks.mockDel.mockRejectedValue(new Error('redis unavailable'));

    const result = await refreshUsersPermissionCache([USER_A, USER_B]);

    expect(result.failed).toBe(2);
    expect(result.succeeded).toBe(0);
  });

  it('用户不存在（denied:not_found）→ 缓存未被刷新，计入 failed 而非 succeeded', async () => {
    const result = await refreshUsersPermissionCache(['00000000-0000-4000-8000-00000000dead']);

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
  });

  it('空数组 → 全 0，且不触碰 Redis', async () => {
    const result = await refreshUsersPermissionCache([]);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(mocks.mockDel).not.toHaveBeenCalled();
  });
});
