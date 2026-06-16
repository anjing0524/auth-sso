/**
 * Redis 客户端配置 (Infrastructure Layer)
 * 用于 Portal Session 存储与权限缓存
 *
 * 统一使用 ioredis 连接 Redis
 *
 * @module infrastructure/redis
 */
import Redis from 'ioredis';

/**
 * 统一的 Redis 客户端接口
 * 定义 Portal 需要的方法
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<'OK' | null>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  quit(): Promise<void>;

  // 集合与过期命令，用于在线会话反向映射索引
  sadd(key: string, member: string): Promise<number>;
  srem(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;

  // Pipeline 批处理命令，用于多会话批量物理注销
  pipeline(): any;
  exists(key: string): Promise<number>;
}

/**
 * Redis 客户端实例
 */
let redisClient: RedisClient | null = null;
let rawIoredisClient: Redis | null = null;

/**
 * 获取原生的 ioredis 客户端实例
 * 专门供 Better Auth 等外部插件/适配器复用现成的连接，防止 TCP 连接冗余
 */
export function getRawIoredisClient(): Redis | null {
  if (!rawIoredisClient) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    rawIoredisClient = new Redis(url, {
      maxRetriesPerRequest: 0, // 严格遵守 Better Auth Redis 驱动的最佳实践限制
      connectTimeout: 5000,
      lazyConnect: true,
    });

    rawIoredisClient.on('error', (err) => {
      console.error('[Redis] Raw ioredis connection error:', err);
    });

    rawIoredisClient.on('connect', () => {
      console.log('[Redis] Raw ioredis Connected');
    });
  }
  return rawIoredisClient;
}

/**
 * 创建 ioredis 客户端
 */
function createIoredisClient(): RedisClient {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  console.log('[Redis] Initializing ioredis with URL:', redisUrl.split('@')[1] || 'localhost');

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    // 如果是 rediss:// 协议，启用 TLS
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
  });

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err);
  });

  client.on('connect', () => {
    console.log('[Redis] Connected');
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
    sadd: (key, member) => client.sadd(key, member),
    srem: (key, member) => client.srem(key, member),
    smembers: (key) => client.smembers(key),
    expire: (key, seconds) => client.expire(key, seconds),
    pipeline: () => client.pipeline(),
    exists: (key) => client.exists(key),
  };
}

/**
 * 获取 Redis 客户端实例（单例模式）
 */
export function getRedis(): RedisClient {
  if (!redisClient) {
    redisClient = createIoredisClient();
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
  if (rawIoredisClient) {
    await rawIoredisClient.quit();
    rawIoredisClient = null;
  }
}
