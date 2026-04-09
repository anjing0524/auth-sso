/**
 * Redis 客户端配置
 * 用于 Customer Graph Session 存储
 *
 * 环境适配:
 * - 本地开发 (NODE_ENV=development): 使用 ioredis 连接 Docker Redis
 * - 生产环境 (NODE_ENV=production): 使用 @upstash/redis 连接 Upstash KV
 *
 * 统一接口: 两种客户端都暴露相同的 API (get, setex, del, keys, quit)
 */
import Redis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';

/**
 * 统一的 Redis 客户端接口
 * 定义 Customer Graph 需要的方法
 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<'OK' | null>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  quit(): Promise<void>;
}

/**
 * 判断是否为生产环境
 */
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Redis 客户端实例
 */
let redisClient: RedisClient | null = null;

/**
 * 创建 ioredis 客户端 (本地开发)
 */
function createIoredisClient(): RedisClient {
  const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';
  console.log('[Redis-CG] Initializing ioredis with URL:', redisUrl.split('@')[1] || 'localhost');

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    console.error('[Redis-CG] Connection error:', err);
  });

  client.on('connect', () => {
    console.log('[Redis-CG] Connected');
  });

  // ioredis API 直接匹配 RedisClient 接口
  return {
    get: (key) => client.get(key),
    setex: (key, seconds, value) => client.setex(key, seconds, value),
    del: (key) => client.del(key),
    keys: (pattern) => client.keys(pattern),
    quit: async () => {
      await client.quit();
    },
  };
}

/**
 * 创建 Upstash Redis 客户端 (生产环境)
 */
function createUpstashClient(): RedisClient {
  console.log('[Redis-CG] Initializing Upstash Redis');

  const client = new UpstashRedis({
    url: process.env['KV_REST_API_URL']!,
    token: process.env['KV_REST_API_TOKEN']!,
  });

  // Upstash Redis API 适配为统一接口
  return {
    get: async (key) => {
      const result = await client.get<string>(key);
      return result ?? null;
    },
    setex: async (key, seconds, value) => {
      // Upstash 使用 set + ex 选项替代 setex
      await client.set(key, value, { ex: seconds });
      return 'OK';
    },
    del: async (key) => {
      const result = await client.del(key);
      return result ?? 0;
    },
    keys: async (pattern: string) => {
      // Upstash 不支持 keys 命令，返回空数组
      console.warn('[Redis-CG] Upstash does not support keys command, returning empty array. Pattern:', pattern);
      return [];
    },
    quit: async () => {
      // Upstash 是 HTTP 客户端，无需关闭连接
    },
  };
}

/**
 * 获取 Redis 客户端实例（单例模式）
 */
export function getRedis(): RedisClient {
  if (!redisClient) {
    redisClient = isProduction ? createUpstashClient() : createIoredisClient();
  }
  return redisClient;
}

/**
 * 关闭 Redis 连接
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}