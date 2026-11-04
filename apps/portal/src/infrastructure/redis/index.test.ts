// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => {
  const client = {
    status: 'wait',
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    ping: vi.fn(),
    get: vi.fn(),
  };

  client.connect.mockImplementation(async () => {
    client.status = 'ready';
  });
  client.ping.mockResolvedValue('PONG');
  client.get.mockResolvedValue(null);

  return { client };
});

vi.mock('ioredis', () => ({
  default: vi.fn(function RedisMock() {
    return redisMock.client;
  }),
}));

vi.mock('@/lib/env', () => ({
  getRedisUrl: () => 'rediss://example.upstash.io:6379',
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import { getRedis } from './index';

describe('Redis lazy connection', () => {
  beforeEach(() => {
    // Vitest 5 不再保证跨用例保留 mock 调用记录；本用例只断言“本用例内”的 connect 次数。
    redisMock.client.connect.mockClear();
  });

  it('冷启动首条命令等待连接 ready 后再执行', async () => {
    const redis = getRedis();

    await expect(redis.ping()).resolves.toBe('PONG');

    expect(redisMock.client.connect).toHaveBeenCalledOnce();
    expect(redisMock.client.connect.mock.invocationCallOrder[0]).toBeLessThan(
      redisMock.client.ping.mock.invocationCallOrder[0]!,
    );
  });

  it('连接 ready 后复用连接，不重复 connect', async () => {
    const redis = getRedis();

    await redis.get('health');

    expect(redisMock.client.connect).not.toHaveBeenCalled();
    expect(redisMock.client.get).toHaveBeenCalledWith('health');
  });
});
