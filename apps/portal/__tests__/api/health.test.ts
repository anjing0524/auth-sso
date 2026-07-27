/**
 * 健康检查路由测试
 *
 * @req OPS-HEALTH-001
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockPing } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockPing: vi.fn(),
}));

vi.mock('@/infrastructure/db', () => ({
  db: { execute: mockExecute },
}));

vi.mock('@/infrastructure/redis', () => ({
  getRedis: () => ({ ping: mockPing }),
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  beforeEach(() => {
    mockExecute.mockResolvedValue(undefined);
    mockPing.mockResolvedValue('PONG');
  });

  it('数据库与 Redis 均可用时返回 200', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'healthy',
      checks: {
        database: { status: 'ok' },
        redis: { status: 'ok' },
      },
    });
  });

  it('Redis 不可用时返回 503', async () => {
    mockPing.mockRejectedValueOnce(new Error('Redis unavailable'));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      checks: {
        database: { status: 'ok' },
        redis: { status: 'fail' },
      },
    });
  });

  it('数据库不可用时返回 503', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Database unavailable'));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      checks: {
        database: { status: 'fail' },
        redis: { status: 'ok' },
      },
    });
  });

  it('数据库与 Redis 同时不可用时返回 unhealthy', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Database unavailable'));
    mockPing.mockRejectedValueOnce(new Error('Redis unavailable'));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'unhealthy',
      checks: {
        database: { status: 'fail' },
        redis: { status: 'fail' },
      },
    });
  });
});
