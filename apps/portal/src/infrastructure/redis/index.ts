/**
 * Redis 客户端配置 (Infrastructure Layer)
 * 用于 Portal Session 存储与权限缓存
 *
 * 统一使用 ioredis 连接 Redis
 *
 * @module infrastructure/redis
 */
import Redis from 'ioredis';
import { getRedisUrl } from '@/lib/env';

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

  // Hash 命令，用于 jti→exp 精确映射（批量撤销时计算每个 JTI 的剩余 TTL）
  hset(key: string, field: string, value: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;

  // Pipeline 批处理命令，用于多会话批量物理注销
  pipeline(): any;
  exists(key: string): Promise<number>;
}

/**
 * Redis 客户端实例
 */
let redisClient: RedisClient | null = null;

/**
 * 创建 ioredis 客户端
 */
function createIoredisClient(): RedisClient {
  const redisUrl = getRedisUrl();
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
    hset: (key, field, value) => client.hset(key, field, value),
    hgetall: (key) => client.hgetall(key),
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

