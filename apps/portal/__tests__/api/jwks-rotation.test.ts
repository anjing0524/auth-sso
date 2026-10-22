/**
 * JWKS 密钥轮换重叠窗口测试 — 真实 DB (jwks 表)
 *
 * 覆盖修复规划 F3：
 * - 提前轮换：签名密钥进入续期窗口（到期前 JWKS_RENEW_AHEAD_SECS）即生成新对
 * - 发布宽限：过期公钥在 JWKS 端点保留 JWKS_PUBLISH_GRACE_SECS（≤ 宽限内可见，
 *   超出宽限移除），保证轮换瞬间存量 token 对冷启动验签方仍可验证
 *
 * @req H-SESS-001~006
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedJwks } from '../helpers/seed-fixtures';

const { mockGetRedis, tdHolder } = vi.hoisted(() => {
  return {
    tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
    mockGetRedis: () => ({
      setex: async () => {},
      exists: async () => 0,
      get: async () => null,
      del: async () => {},
      hset: async () => 1,
      hgetall: async () => ({}),
      expire: async () => 1,
      pipeline: () => ({
        setex: function () { return this; },
        del: function () { return this; },
        exec: async () => [],
      }),
    }),
  };
});

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/infrastructure/redis', () => ({
  getRedis: () => mockGetRedis(),
}));

// jwks route 调用 next/server 的 connection()（请求外调用会抛错），部分 mock 掉
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, connection: vi.fn(async () => {}) };
});

// 本文件测的是轮换窗口逻辑而非密钥材料：夹具的静态 JWK 不在 P-256 曲线上，
// mock 掉真实 importJWK（生成路径的 generateKeyPair/exportJWK 保留真实实现）
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return { ...actual, importJWK: vi.fn(async () => ({}) as CryptoKey) };
});

import { getActiveSigningKey } from '@/lib/auth/token';
import { GET as jwksGET } from '@/app/api/auth/jwks/route';
import { JWKS_RENEW_AHEAD_SECS, JWKS_PUBLISH_GRACE_SECS } from '@auth-sso/contracts';

const td = createTestDbHandle();
tdHolder.current = td;

const HOUR = 3600 * 1000;

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
});

describe('getActiveSigningKey — 提前轮换窗口（F3）', () => {
  it('距过期仍大于续期窗口时沿用现有密钥，不生成新对', async () => {
    const row = seedJwks({
      kid: 'kid-far',
      expiresAt: new Date(Date.now() + (JWKS_RENEW_AHEAD_SECS + 3600) * 1000),
    })[0]!;
    await seedTestData(td.db, { jwks: [row] });

    const key = await getActiveSigningKey();

    expect(key.keyId).toBe('kid-far');
    const rows = await td.db.select().from(td.schema.jwks);
    expect(rows).toHaveLength(1);
  });

  it('进入续期窗口（到期前 < JWKS_RENEW_AHEAD_SECS）即生成新密钥对', async () => {
    const row = seedJwks({
      kid: 'kid-near',
      expiresAt: new Date(Date.now() + (JWKS_RENEW_AHEAD_SECS - 3600) * 1000),
    })[0]!;
    await seedTestData(td.db, { jwks: [row] });

    const key = await getActiveSigningKey();

    expect(key.keyId).not.toBe('kid-near');
    const rows = await td.db.select().from(td.schema.jwks);
    expect(rows).toHaveLength(2);
  });
});

describe('GET /api/auth/jwks — 发布宽限窗口（F3）', () => {
  it('过期 ≤ JWKS_PUBLISH_GRACE_SECS 的公钥仍在 JWKS 中（重叠窗口）', async () => {
    const oldRow = seedJwks({
      kid: 'kid-old-in-grace',
      expiresAt: new Date(Date.now() - (JWKS_PUBLISH_GRACE_SECS * 1000 - 60 * 1000)),
      createdAt: new Date(Date.now() - 2 * HOUR),
    })[0]!;
    const freshRow = seedJwks({ kid: 'kid-fresh', createdAt: new Date() })[0]!;
    await seedTestData(td.db, { jwks: [oldRow, freshRow] });

    const res = await jwksGET();
    const json = await res.json();
    const kids = json.keys.map((k: { kid: string }) => k.kid);

    expect(kids).toContain('kid-old-in-grace');
    expect(kids).toContain('kid-fresh');
  });

  it('过期超出 JWKS_PUBLISH_GRACE_SECS 的公钥从 JWKS 移除', async () => {
    const staleRow = seedJwks({
      kid: 'kid-stale',
      expiresAt: new Date(Date.now() - (JWKS_PUBLISH_GRACE_SECS + 3600) * 1000),
      createdAt: new Date(Date.now() - 100 * 24 * HOUR),
    })[0]!;
    const freshRow = seedJwks({ kid: 'kid-fresh-2', createdAt: new Date() })[0]!;
    await seedTestData(td.db, { jwks: [staleRow, freshRow] });

    const res = await jwksGET();
    const json = await res.json();
    const kids = json.keys.map((k: { kid: string }) => k.kid);

    expect(kids).not.toContain('kid-stale');
    expect(kids).toContain('kid-fresh-2');
  });
});
