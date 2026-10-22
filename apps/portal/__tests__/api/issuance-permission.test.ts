/**
 * 签发路径的权限分级 —— 唯一出处与三种结局
 *
 * `resolveIssuancePermission` 是**签发路径消费权限上下文的唯一分级出处**（ADR-011 / ADR-018）。
 * 此前这段分级在 `oauth-grant.ts`（授权码兑换）与 `token.ts`（RT 轮换）**各写一遍**，
 * 而它只能靠三个测试文件各自的替身开关才被测到——本文件把它拉到一个 seam 上直接打靶。
 *
 * 三种结局各自可断言：
 * - `ok` → `{ ok: true, prefilled: true }` 且缓存**确实**被回填（真实 DB 驱动）
 * - `denied`（not_found / inactive）→ `{ ok: false, reason }` 且**不回填**
 * - `unavailable`（真实 DB 故障）→ `{ ok: true, prefilled: false }`：**不阻断签发**，
 *   只跳过预填充（这正是 ADR-018 要保住的那条分支）
 *
 * @req NFR-SEC-14, H-PERM-004
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept, seedTestUser } from '../helpers/seed-fixtures';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: {
    mockGet: vi.fn(async (_key: string) => null as string | null),
    mockSetex: vi.fn(async (_key: string, _seconds: number, _value: string) => 'OK' as const),
  },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

// 基础设施边界：Redis 用替身（本文件的被测对象是**分级语义**，不是 Redis 行为）
vi.mock('@/infrastructure/redis', () => ({
  getRedis: () => ({
    get: mocks.mockGet,
    setex: mocks.mockSetex,
    del: vi.fn(async () => 1),
    hgetall: vi.fn(async () => ({})),
    hset: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    pipeline: () => ({ setex: vi.fn(), del: vi.fn(), exec: vi.fn(async () => []) }),
  }),
}));

// 真实 PostgreSQL：成功与否决路径由**真实用户行**驱动
vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

import { resolveIssuancePermission } from '@/lib/permissions';

const ACTIVE_USER = '00000000-0000-4000-8000-000000000101';
const DISABLED_USER = '00000000-0000-4000-8000-000000000201';
const MISSING_USER = '00000000-0000-4000-8000-00000000dead';

const td = createTestDbHandle();
tdHolder.current = td;

/** 预填充写的是**无后缀**的缓存键；`denied`/`unavailable` 的标记各带 `:null` / `:unavailable` 后缀 */
const prefillKeys = () => mocks.mockSetex.mock.calls.map((c) => c[0]);

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.mockGet.mockResolvedValue(null);
  mocks.mockSetex.mockResolvedValue('OK');
  tdHolder.current = td;
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: [
      ...seedAdminUser(),
      ...seedTestUser({ status: 'DISABLED' }),
    ],
  });
});

/** 注入真实 DB 故障：连上再关掉，使后续查询走真实错误路径而非假对象 */
async function injectDatabaseFailure() {
  const broken = createTestDbHandle();
  await broken.connect();
  await broken.close();
  tdHolder.current = broken;
}

describe('resolveIssuancePermission — 签发路径的唯一分级', () => {
  it('ACTIVE 用户 → ok 且**真的回填了缓存**（真实 DB 驱动）', async () => {
    const permission = await resolveIssuancePermission(ACTIVE_USER);

    expect(permission).toEqual({ ok: true, prefilled: true });
    expect(prefillKeys().some((k) => k.endsWith(ACTIVE_USER))).toBe(true);
  });

  it('用户不存在 → **denied:not_found**，且不回填上下文缓存', async () => {
    const permission = await resolveIssuancePermission(MISSING_USER);

    expect(permission).toEqual({ ok: false, reason: 'not_found' });
    expect(prefillKeys().some((k) => k.endsWith(MISSING_USER))).toBe(false);
  });

  it('用户非 ACTIVE → **denied:inactive**（否决性数据，必须拒绝签发）', async () => {
    const permission = await resolveIssuancePermission(DISABLED_USER);

    expect(permission).toEqual({ ok: false, reason: 'inactive' });
    expect(prefillKeys().some((k) => k.endsWith(DISABLED_USER))).toBe(false);
  });

  it('**DB 故障 → ok 但 prefilled=false**（ADR-018：不阻断签发，只跳过预填充）', async () => {
    await injectDatabaseFailure();

    const permission = await resolveIssuancePermission(ACTIVE_USER);

    expect(permission).toEqual({ ok: true, prefilled: false });
    expect(prefillKeys().some((k) => k.endsWith(ACTIVE_USER))).toBe(false);
  });
});
