/**
 * Redis 客户端配置 (Infrastructure Layer)
 * 用于 Portal Session 存储与权限缓存
 *
 * 统一使用 ioredis 连接 Redis
 *
 * @module infrastructure/redis
 */
import Redis, { type ChainableCommander } from 'ioredis';
import { getRedisUrl } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const log = createLogger('Redis');

/**
 * 统一的 Redis 客户端接口
 * 定义 Portal 需要的方法
 */
export interface RedisClient {
  /** 确保 lazy client 已完成连接；关键会话写入不得依赖 offline queue。 */
  connect(): Promise<void>;
  get(key: string): Promise<string | null>;
  /** 原子读取并删除（GETDEL，Redis 6.2+），用于一次性消费场景 */
  getdel(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<'OK' | null>;
  /** 删除一个或多个 key */
  del(...keys: string[]): Promise<number>;
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
  pipeline(): ChainableCommander;
  exists(key: string): Promise<number>;

  // 原子计数器命令（用于暴力破解防护等竞态条件场景）
  incr(key: string): Promise<number>;
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
  // 日志中仅输出主机信息，避免凭据泄漏
  log.info('Initializing ioredis', { host: redisUrl.split('@').pop()?.split('/')[0] || 'localhost' });

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    connectTimeout: 3_000,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => (attempt <= 3 ? attempt * 200 : null),
    lazyConnect: true,
    // 如果是 rediss:// 协议，启用 TLS
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
  });

  client.on('error', (err) => {
    log.error('Connection error', { error: err.message });
  });

  client.on('connect', () => {
    log.info('Connected');
  });

  let connectPromise: Promise<void> | null = null;
  const connect = async (): Promise<void> => {
    if (client.status === 'ready') return;
    if (client.status === 'connecting' || client.status === 'connect' || client.status === 'reconnecting') {
      await new Promise<void>((resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          client.off('ready', onReady);
          client.off('error', onError);
        };
        client.once('ready', onReady);
        client.once('error', onError);
      });
      return;
    }
    if (!connectPromise) {
      connectPromise = client.connect().finally(() => {
        connectPromise = null;
      });
    }
    await connectPromise;
  };

  // ioredis API 直接匹配 RedisClient 接口
  return {
    connect,
    get: (key) => client.get(key),
    getdel: (key) => client.getdel(key),
    setex: (key, seconds, value) => client.setex(key, seconds, value),
    del: (...keys) => client.del(...keys),
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
    incr: (key) => client.incr(key),
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
