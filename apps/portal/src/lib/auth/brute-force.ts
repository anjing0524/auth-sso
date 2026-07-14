import 'server-only';

/**
 * 暴力破解防护模块
 *
 * 使用 Redis 原子计数（优先）+ DB login_logs 查询（回退）检测登录暴力破解。
 * Redis 不可用时自动回退到 DB 查询（通过 lastLoginAt 排除历史失败实现清零）。
 *
 * 阈值可通过环境变量 BRUTE_FORCE_MAX_ATTEMPTS / BRUTE_FORCE_WINDOW_MINUTES 覆盖。
 *
 * @module lib/auth/brute-force
 */
import { db, schema } from '@/infrastructure/db';
import { getRedis } from '@/infrastructure/redis';
import { eq, and, gte, sql, count } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { REDIS_KEY_PREFIX } from '@auth-sso/contracts';

const log = createLogger('BruteForce');

/** 最大失败次数（环境变量覆盖，默认 5） */
export const BRUTE_FORCE_MAX_ATTEMPTS = (() => {
  const raw = process.env['BRUTE_FORCE_MAX_ATTEMPTS'];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return parsed > 0 ? parsed : 5;
})();

/** 锁定窗口（分钟，环境变量覆盖，默认 15） */
export const BRUTE_FORCE_WINDOW_MINUTES = (() => {
  const raw = process.env['BRUTE_FORCE_WINDOW_MINUTES'];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return parsed > 0 ? parsed : 15;
})();

const FAIL_COUNT_KEY_PREFIX = REDIS_KEY_PREFIX.LOGIN_FAIL;
const WINDOW_SEC = BRUTE_FORCE_WINDOW_MINUTES * 60;

/**
 * 检查登录暴力破解锁定状态 (只读，无 side-effect)
 *
 * @param userId 用户 ID
 * @returns 锁定状态与提示消息
 */
export async function checkBruteForce(
  userId: string,
): Promise<{ locked: boolean; message?: string }> {
  const failCountKey = `${FAIL_COUNT_KEY_PREFIX}${userId}`;
  let failCount = 0;
  let useRedisCount = false;

  // 1. 优先从 Redis 获取失败计数
  try {
    const redis = getRedis();
    if (redis) {
      const countStr = await redis.get(failCountKey);
      failCount = countStr ? parseInt(countStr, 10) : 0;
      useRedisCount = true;
    }
  } catch (err) {
    // Redis 故障，静默降级到 DB；记录警告供监控发现
    log.warn('Redis 不可用，降级到 DB 查询', { error: err instanceof Error ? err.message : String(err) });
  }

  // 2. 回退到 DB 查询 (如果 Redis 无法获取计数)
  if (!useRedisCount) {
    try {
      // 合并两次查询为单次：用子查询获取 lastLoginAt，避免多次往返
      // 仅统计最近成功登录时间之后（或 15 分钟窗口内）的失败日志（DB Fallback 自动清零）
      const lockWindowStart = new Date(Date.now() - WINDOW_SEC * 1000);
      const result = await db
        .select({ count: count() })
        .from(schema.loginLogs)
        .where(
          and(
            eq(schema.loginLogs.userId, userId),
            eq(schema.loginLogs.eventType, 'LOGIN_FAILED'),
            gte(
              schema.loginLogs.createdAt,
              // 取 lastLoginAt 和 窗口起点 中较大者，通过 GREATEST 函数在 DB 层计算
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
      // Redis 和 DB 双重不可用，出于安全考量必须 fail-close，阻止登录
      throw new Error('暴力破解防范服务不可用');
    }
  }

  if (failCount >= BRUTE_FORCE_MAX_ATTEMPTS) {
    return { locked: true, message: `登录失败次数过多，账户已临时锁定，请${BRUTE_FORCE_WINDOW_MINUTES}分钟后重试` };
  }

  return { locked: false };
}

/**
 * 递增暴力破解失败计数
 *
 * @param userId 用户 ID
 */
export async function incrementBruteForce(userId: string): Promise<void> {
  const failCountKey = `${FAIL_COUNT_KEY_PREFIX}${userId}`;
  try {
    const redis = getRedis();
    if (redis) {
      const count = await redis.incr(failCountKey);
      if (count === 1) {
        await redis.expire(failCountKey, WINDOW_SEC);
      }
    }
  } catch (err) {
    // Redis 故障时不阻断密码错误的反馈，因为 DB 已写登录日志，降级查询时会自动覆盖
    log.warn('递增计数失败（Redis 故障）', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * 管理员手工解除暴力破解锁定（清除 Redis 计数器）。
 *
 * 与 clearBruteForceCounter 等效，但语义更明确——专供管理员解锁使用，
 * 区别于密码正确后的自动清零。
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
    // 清除失败不阻断登录成功流程。错误仅记录警告以便监控
    log.warn('清除计数器失败（Redis 故障）', { error: err instanceof Error ? err.message : String(err) });
  }
}
