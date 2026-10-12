/**
 * API project 真实 Redis 基线的共享部分：地址解析 + 测试用客户端工厂
 *
 * 探针（vitest.globalSetup.ts）、每用例清库钩子（vitest.api.setup.ts）与被测生产
 * 代码必须指向**同一个逻辑库**，否则"探针通了"与"用例跑在干净库上"不成立。
 * 地址解析只在这里做一次，并由 vitest.api.config.ts 的 `test.env` 决定性覆盖
 * `REDIS_URL`——三者由此天然对齐。
 */
import Redis from 'ioredis';

/** 兜底地址：与 Docker Compose 暴露的本地 redis 一致 */
const DEFAULT_TEST_REDIS_URL = 'redis://127.0.0.1:6379';

/** API project 专用逻辑库：默认落在 db1，不动应用默认库 db0 上的真数据 */
const TEST_REDIS_DATABASE = '1';

/**
 * 未显式带逻辑库时补上测试专用逻辑库。
 * 显式带库（如 `redis://host:6379/2`）时尊重显式值——`TEST_REDIS_URL` 是逃生口。
 */
function withDefaultLogicalDatabase(redisUrl: string): string {
  const url = new URL(redisUrl);
  if (url.pathname === '' || url.pathname === '/') {
    url.pathname = `/${TEST_REDIS_DATABASE}`;
  }
  return url.toString();
}

/**
 * 解析本次测试要用的 Redis 地址：`TEST_REDIS_URL` ?? `REDIS_URL` ?? 本地兜底。
 * 该函数是幂等的：对已带逻辑库的结果再次调用不会改变它。
 */
export function resolveTestRedisUrl(): string {
  const raw = process.env['TEST_REDIS_URL'] || process.env['REDIS_URL'] || DEFAULT_TEST_REDIS_URL;
  return withDefaultLogicalDatabase(raw);
}

/**
 * 创建测试专用 ioredis 客户端。
 *
 * 探针与清库钩子必须共享**同一套连接语义**：若两者选项漂移（比如一边不限制重试），
 * 探针可能通过而清库动作挂起，用例隔离就静默失效了——所以工厂只此一处。
 * 重试策略返回 null = 不重连，连不上立刻失败（宁快失败，不给"环境的函数"留空间）。
 * 连接失败由调用方的 await 抛出；工厂自己吸收 `error` 事件，避免 unhandled error。
 */
export function createTestRedisClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });

  client.on('error', () => {});

  return client;
}
