/**
 * @req NFR-SEC-06
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkBruteForce, checkIpRateLimit, incrementBruteForce, clearBruteForceCounter } from '@/lib/auth/brute-force';

// ======== Redis Mock ========
const { redisStore, redisState, mockRedis } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const state = { redisError: false };
  const mockRedis = {
    get: vi.fn(async (key: string) => {
      if (state.redisError) throw new Error('Redis down');
      return store.get(key) || null;
    }),
    incr: vi.fn(async (key: string) => {
      if (state.redisError) throw new Error('Redis down');
      const val = parseInt(store.get(key) || '0', 10) + 1;
      store.set(key, String(val));
      return val;
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (key: string) => {
      if (state.redisError) throw new Error('Redis down');
      store.delete(key);
      return 1;
    }),
  };
  return { redisStore: store, redisState: state, mockRedis };
});

vi.mock('@/infrastructure/redis', () => {
  return {
    getRedis: vi.fn(() => {
      if (redisState.redisError) throw new Error('Redis down');
      return mockRedis;
    }),
  };
});

// ======== DB Mock ========
const { dbState, mockDb } = vi.hoisted(() => {
  const state = {
    lastLoginAt: new Date(0),
    failLogsCount: 0,
    dbError: false,
  };
  
  const mockDb = {
    select: vi.fn(() => {
      if (state.dbError) throw new Error('DB down');
      const selectChain = {
        from: vi.fn(() => selectChain),
        where: vi.fn(() => selectChain),
        limit: vi.fn(() => Promise.resolve([{ lastLoginAt: state.lastLoginAt }])),
        then: (resolve: any) => resolve([{ count: state.failLogsCount }]),
      };
      return selectChain;
    }),
  };
  return { dbState: state, mockDb };
});

vi.mock('@/infrastructure/db', () => {
  return {
    db: mockDb,
    schema: {
      users: { id: 'id', lastLoginAt: 'lastLoginAt', deptId: 'deptId' },
      loginLogs: { userId: 'userId', eventType: 'eventType', createdAt: 'createdAt', ip: 'ip' },
    },
  };
});

describe('Brute Force Domain Logic', () => {
  beforeEach(() => {
    redisStore.clear();
    redisState.redisError = false;
    dbState.dbError = false;
    dbState.failLogsCount = 0;
    dbState.lastLoginAt = new Date(0);
    vi.clearAllMocks();
  });

  describe('Redis Available Path', () => {
    it('should allow login when key has no attempts in Redis', async () => {
      const res = await checkBruteForce('user-1', '10.0.0.1');
      expect(res.locked).toBe(false);
    });

    it('should lock when attempts reach maximum in Redis', async () => {
      // 模拟失败 4 次
      for (let i = 0; i < 4; i++) {
        await incrementBruteForce('user-1', '10.0.0.1');
      }
      expect((await checkBruteForce('user-1', '10.0.0.1')).locked).toBe(false);

      // 第 5 次失败
      await incrementBruteForce('user-1', '10.0.0.1');
      const res = await checkBruteForce('user-1', '10.0.0.1');
      expect(res.locked).toBe(true);
      expect(res.message).toContain('锁定');
    });

    it('should unlock when cleared', async () => {
      await incrementBruteForce('user-1', '10.0.0.1');
      await incrementBruteForce('user-1', '10.0.0.1');
      await incrementBruteForce('user-1', '10.0.0.1');
      await incrementBruteForce('user-1', '10.0.0.1');
      await incrementBruteForce('user-1', '10.0.0.1'); // Locked
      
      expect((await checkBruteForce('user-1', '10.0.0.1')).locked).toBe(true);
      
      await clearBruteForceCounter('user-1', '10.0.0.1');
      expect((await checkBruteForce('user-1', '10.0.0.1')).locked).toBe(false);
    });
  });

  describe('DB Fallback Path', () => {
    beforeEach(() => {
      redisState.redisError = true; // Redis 异常，触发 fallback 到 DB
    });

    it('should query DB and allow login when failures are below limit', async () => {
      dbState.failLogsCount = 3;
      const res = await checkBruteForce('user-1', '10.0.0.1');
      expect(res.locked).toBe(false);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should query DB and lock login when failures reach limit', async () => {
      dbState.failLogsCount = 5;
      const res = await checkBruteForce('user-1', '10.0.0.1');
      expect(res.locked).toBe(true);
      expect(res.message).toContain('锁定');
    });

    it('should fail-close when both Redis and DB are down', async () => {
      dbState.dbError = true;
      await expect(checkBruteForce('user-1', '10.0.0.1')).rejects.toThrow('暴力破解防范服务不可用');
    });
  });
});

describe('ADR-025 双维度与定向 DoS', () => {
  beforeEach(() => {
    redisStore.clear();
    redisState.redisError = false;
    dbState.dbError = false;
    dbState.failLogsCount = 0;
    dbState.lastLoginAt = new Date(0);
    vi.clearAllMocks();
  });

  it('同一账户从单个 IP 失败 5 次只会锁定该 IP，不会锁死其他 IP', async () => {
    for (let i = 0; i < 5; i += 1) await incrementBruteForce('victim', '203.0.113.9');

    expect((await checkBruteForce('victim', '203.0.113.9')).locked).toBe(true);
    // 受害者从自己的 IP 登录：账户×IP 计数为 0，不应被攻击者连累
    expect((await checkBruteForce('victim', '198.51.100.7')).locked).toBe(false);
  });

  it('IP 维度失败总量达 20 次 → rateLimited（跨账户累计）', async () => {
    for (let i = 0; i < 20; i += 1) await incrementBruteForce(null, '203.0.113.9');

    const res = await checkBruteForce('someone', '203.0.113.9');
    expect(res.rateLimited).toBe(true);
    expect(res.locked).toBe(false);
    expect(res.message).toContain('IP');
    expect(await checkIpRateLimit('203.0.113.9')).toContain('IP');
  });

  it('登录成功只清账户×IP 计数，不清 IP 总量（撞库来源不被单次成功洗白）', async () => {
    await incrementBruteForce('user-1', '10.0.0.1');
    expect((await checkBruteForce('user-1', '10.0.0.1')).locked).toBe(false);
    await clearBruteForceCounter('user-1', '10.0.0.1');
    expect(await checkBruteForce('user-1', '10.0.0.1')).toEqual({ locked: false });
    // IP 计数仍在（20 次里已用 1 次）
    for (let i = 0; i < 19; i += 1) await incrementBruteForce(null, '10.0.0.1');
    expect((await checkBruteForce('user-2', '10.0.0.1')).rateLimited).toBe(true);
  });
});
