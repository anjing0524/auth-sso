import 'server-only';

/**
 * 暴力破解防护模块
 *
 * 使用 Redis 原子计数（优先）+ DB login_logs 查询（回退）检测登录暴力破解。
 * Redis 不可用时自动回退到 DB 查询（通过 lastLoginAt 排除历史失败实现清零）。
 *
 * 阈值可通过环境变量 BRUTE_FORCE_MAX_ATTEMPTS / BRUTE_FORCE_WINDOW_MINUTES 覆盖，
 * 或通过 BruteForceConfig 显式注入（供测试使用）。
 *
 * @module lib/auth/brute-force
 */
import { db, schema } from '@/infrastructure/db';
import { getRedis } from '@/infrastructure/redis';
import { eq, and, gte, sql, count } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { REDIS_KEY_PREFIX } from '@auth-sso/contracts';

const log = createLogger('BruteForce');

// ── 配置接口（可注入，供测试使用）─────────────────────────────────────

export interface BruteForceConfig {
  maxAttempts: number;
  windowMinutes: number;
}

export const DEFAULT_BRUTE_FORCE_CONFIG: BruteForceConfig = {
  maxAttempts: 5,
  windowMinutes: 15,
};

// ── 模块级默认值（向后兼容：从 process.env 读取）───────────────

export const BRUTE_FORCE_MAX_ATTEMPTS = (() => {
  const raw = process.env['BRUTE_FORCE_MAX_ATTEMPTS'];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return parsed > 0 ? parsed : DEFAULT_BRUTE_FORCE_CONFIG.maxAttempts;
})();

export const BRUTE_FORCE_WINDOW_MINUTES = (() => {
  const raw = process.env['BRUTE_FORCE_WINDOW_MINUTES'];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return parsed > 0 ? parsed : DEFAULT_BRUTE_FORCE_CONFIG.windowMinutes;
})();

const FAIL_COUNT_KEY_PREFIX = REDIS_KEY_PREFIX.LOGIN_FAIL;
const WINDOW_SEC = BRUTE_FORCE_WINDOW_MINUTES * 60;

function resolveWindowSec(config?: BruteForceConfig): number {
  return config ? config.windowMinutes * 60 : WINDOW_SEC;
}

function resolveMaxAttempts(config?: BruteForceConfig): number {
  return config?.maxAttempts ?? BRUTE_FORCE_MAX_ATTEMPTS;
}

/**
 * 检查登录暴力破解锁定状态 (只读，无 side-effect)
 *
 * @param userId 用户 ID
 * @param config 可选配置注入
 * @returns 锁定状态与提示消息
 */
export async function checkBruteForce(
  userId: string,
  config?: BruteForceConfig,
): Promise<{ locked: boolean; message?: string }> {
  const failCountKey = `${FAIL_COUNT_KEY_PREFIX}${userId}`;
  let failCount = 0;
  let useRedisCount = false;

  const windowSec = resolveWindowSec(config);

  // 1. 优先从 Redis 获取失败计数
  try {
    const redis = getRedis();
    if (redis) {
      const countStr = await redis.get(failCountKey);
      failCount = countStr ? parseInt(countStr, 10) : 0;
      useRedisCount = true;
    }
  } catch (err) {
    log.warn('Redis 不可用，降级到 DB 查询', { error: err instanceof Error ? err.message : String(err) });
  }

  // 2. 回退到 DB 查询 (如果 Redis 无法获取计数)
  if (!useRedisCount) {
    try {
      const lockWindowStart = new Date(Date.now() - windowSec * 1000);
      const result = await db
        .select({ count: count() })
        .from(schema.loginLogs)
        .where(
          and(
            eq(schema.loginLogs.userId, userId),
            eq(schema.loginLogs.eventType, 'LOGIN_FAILED'),
            gte(
              schema.loginLogs.createdAt,
              sql<Date>`GREATEST(
                ${lockWindowStart.toISOString()}::timestamptz,
                COALESCE(
                  (SELECT last_login_at FROM users WHERE id = ${userId} LIMIT 1),
                  '-infinity'::timestamptz
                )
              )`,
            ),
          ),
        );
      failCount = result[0]?.count ?? 0;
    } catch (_err) {
      throw new Error('暴力破解防范服务不可用');
    }
  }

  const maxAttempts = resolveMaxAttempts(config);
  const windowMinutes = config?.windowMinutes ?? BRUTE_FORCE_WINDOW_MINUTES;

  if (failCount >= maxAttempts) {
    return { locked: true, message: `登录失败次数过多，账户已临时锁定，请${windowMinutes}分钟后重试` };
  }

  return { locked: false };
}

/**
 * 递增暴力破解失败计数
 *
 * @param userId 用户 ID
 * @param config 可选配置注入
 */
export async function incrementBruteForce(userId: string, config?: BruteForceConfig): Promise<void> {
  const failCountKey = `${FAIL_COUNT_KEY_PREFIX}${userId}`;
  const windowSec = resolveWindowSec(config);
  try {
    const redis = getRedis();
    if (redis) {
      const count = await redis.incr(failCountKey);
      if (count === 1) {
        await redis.expire(failCountKey, windowSec);
      }
    }
  } catch (err) {
    log.warn('递增计数失败（Redis 故障）', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * 管理员手工解除暴力破解锁定（清除 Redis 计数器）。
 *
 * @param userId 用户 ID
 */
export async function resetBruteForceCounter(userId: string): Promise<void> {
  return clearBruteForceCounter(userId);
}

/**
 * 密码验证成功后清除暴力破解计数器
 *
 * @param userId 用户 ID
 */
export async function clearBruteForceCounter(userId: string): Promise<void> {
  try {
    const redis = getRedis();
    if (redis) {
      await redis.del(`${FAIL_COUNT_KEY_PREFIX}${userId}`);
    }
  } catch (err) {
    log.warn('清除计数器失败（Redis 故障）', { error: err instanceof Error ? err.message : String(err) });
  }
}
