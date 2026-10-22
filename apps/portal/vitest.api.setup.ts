/**
 * API project 专属 Vitest Setup：真实 Redis 基线
 *
 * 与 `vitest.setup.ts` 分开的理由：后者由 API 与 UI 两个 project 共享，而
 * UI/domain project 必须继续在**不依赖数据库/Redis** 的机器上通过（AGENTS.md
 * 的硬约束）。真实 Redis 只属于 API project。
 *
 * 每个用例前用**独立 ioredis 客户端**执行 `FLUSHDB`，角色等同 PostgreSQL 侧
 * 的 `TRUNCATE CASCADE`：
 * - 只清当前逻辑库（库号由 vitest.redis.ts 解析，默认 db1）；
 * - **禁止 `FLUSHALL`**——共享 Redis 上不能清掉别的库。
 *
 * 专用客户端而非 `@/infrastructure/redis` 单例：清库动作不应与被测代码共享
 * 连接生命周期，也不应被任何模块级 mock 影响。
 */
import { afterAll, beforeEach } from 'vitest';
import type Redis from 'ioredis';
import { createTestRedisClient, resolveTestRedisUrl } from './vitest.redis';

let flushClient: Redis | null = null;

function getFlushClient(): Redis {
  if (!flushClient) {
    flushClient = createTestRedisClient(resolveTestRedisUrl());
  }
  return flushClient;
}

beforeEach(async () => {
  const client = getFlushClient();
  if (client.status !== 'ready') {
    await client.connect();
  }
  await client.flushdb();
});

afterAll(async () => {
  const client = flushClient;
  flushClient = null;
  if (client) {
    await client.quit().catch(() => {});
  }
});
