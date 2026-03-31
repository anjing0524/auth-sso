/**
 * Redis 连接模块
 * 用于 Session 存储、缓存、授权码等
 */
import Redis from 'ioredis';

/**
 * Redis 客户端实例
 */
let redis: Redis | null = null;

/**
 * 获取 Redis 客户端
 * 单例模式，确保只有一个连接
 */
export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: () => 100,
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err);
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }
  return redis;
}

/**
 * 关闭 Redis 连接
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
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