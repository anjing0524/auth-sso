/**
 * Redis 客户端配置
 * 用于 Portal Session 存储
 */
import Redis from 'ioredis';

let redis: Redis | null = null;

/**
 * 获取 Redis 客户端实例（单例模式）
 */
export function getRedis(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    console.log('[Redis] Initializing with URL:', redisUrl.split('@')[1] || 'localhost');
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
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