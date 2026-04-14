/**
 * Redis 连接模块
 * 用于 Session 存储、缓存、授权码等
 *
 * 环境适配:
 * - 本地开发 (NODE_ENV=development): 使用 ioredis 连接 Docker Redis
 * - 生产环境 (NODE_ENV=production): 使用 @upstash/redis 连接 Upstash KV
 *
 * 统一接口: 两种客户端都暴露相同的 API
 */
import Redis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';

/**
 * 统一的 Redis 客户端接口
 * 定义 IdP 需要的方法
 */
interface RedisClient {
  // 基础操作
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number; px?: number }): Promise<'OK' | null>;
  setex(key: string, seconds: number, value: string): Promise<'OK' | null>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;

  // 过期时间
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;

  // 扫描 (生产环境建议用 scan 替代 keys)
  keys(pattern: string): Promise<string[]>;

  // 哈希表操作
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, field: string): Promise<number>;

  // 关闭连接
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
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: () => 100,
    lazyConnect: true,
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
    set: (key, value, options) => {
      if (options?.ex) return client.set(key, value, 'EX', options.ex);
      if (options?.px) return client.set(key, value, 'PX', options.px);
      return client.set(key, value);
    },
    setex: (key, seconds, value) => client.setex(key, seconds, value),
    del: (key) => client.del(key),
    exists: (key) => client.exists(key),
    expire: (key, seconds) => client.expire(key, seconds),
    ttl: (key) => client.ttl(key),
    keys: (pattern) => client.keys(pattern),
    hset: (key, field, value) => client.hset(key, field, value),
    hget: (key, field) => client.hget(key, field),
    hgetall: (key) => client.hgetall(key),
    hdel: (key, field) => client.hdel(key, field),
    quit: async () => { await client.quit(); },
  };
}

/**
 * 创建 Upstash Redis 客户端 (生产环境)
 */
function createUpstashClient(): RedisClient {
  console.log('[Redis] Upstash Redis initialized');

  const client = new UpstashRedis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });

  // Upstash Redis API 适配为统一接口
  return {
    get: async (key) => {
      const result = await client.get<string>(key);
      return result ?? null;
    },
    set: async (key, value, options) => {
      // Upstash Redis 的 set 选项类型需要精确匹配
      if (options?.ex) {
        await client.set(key, value, { ex: options.ex });
      } else if (options?.px) {
        await client.set(key, value, { px: options.px });
      } else {
        await client.set(key, value);
      }
      return 'OK';
    },
    setex: async (key, seconds, value) => {
      await client.set(key, value, { ex: seconds });
      return 'OK';
    },
    del: async (key) => {
      const result = await client.del(key);
      return result ?? 0;
    },
    exists: async (key) => {
      const result = await client.exists(key);
      return result ?? 0;
    },
    expire: async (key, seconds) => {
      // Upstash 可能不支持 expire，这里做兼容
      const value = await client.get<string>(key);
      if (value) {
        await client.set(key, value, { ex: seconds });
        return 1;
      }
      return 0;
    },
    ttl: async (_key) => {
      // Upstash 不支持 ttl，返回 -2 (key 不存在) 或 -1 (无过期时间)
      console.warn('[Redis] Upstash does not support ttl command');
      return -1;
    },
    keys: async (_pattern) => {
      // Upstash 不支持 keys 命令
      console.warn('[Redis] Upstash does not support keys command');
      return [];
    },
    hset: async (key, field, value) => {
      const result = await client.hset(key, { [field]: value });
      return result ?? 0;
    },
    hget: async (key, field) => {
      const result = await client.hget<string>(key, field);
      return result ?? null;
    },
    hgetall: async (key) => {
      const result = await client.hgetall<Record<string, string>>(key);
      return result ?? {};
    },
    hdel: async (key, field) => {
      const result = await client.hdel(key, field);
      return result ?? 0;
    },
    quit: async () => {
      // Upstash 是 HTTP 客户端，无需关闭连接
    },
  };
}

/**
 * 获取 Redis 客户端
 * 单例模式，确保只有一个连接
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

/**
 * Redis Key 前缀
 */
export const REDIS_KEYS = {
  // IdP Session
  IDP_SESSION: (sessionId: string) => `idp:session:${sessionId}`,

  // 授权码
  AUTH_CODE: (code: string) => `idp:auth_code:${code}`,

  // PKCE 验证数据
  PKCE: (code: string) => `idp:pkce:${code}`,

  // 用户权限缓存
  USER_PERMISSIONS: (userId: string) => `idp:user_perms:${userId}`,

  // Token 黑名单
  TOKEN_BLACKLIST: (token: string) => `idp:token_blacklist:${token}`,

  // 限流
  RATE_LIMIT: (key: string) => `idp:rate_limit:${key}`,
} as const;

/**
 * 默认 TTL 配置 (秒)
 */
export const TTL = {
  AUTH_CODE: 600, // 10 分钟
  PKCE: 600, // 10 分钟
  SESSION: 604800, // 7 天
  USER_PERMISSIONS: 300, // 5 分钟
  RATE_LIMIT: 60, // 1 分钟
} as const;