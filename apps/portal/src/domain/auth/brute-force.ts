import 'server-only';

/**
 * 暴力破解防护模块
 *
 * 使用 Redis 原子计数（优先）+ DB login_logs 查询（回退）检测登录暴力破解。
 * Redis 不可用时自动回退到 DB 查询（通过 lastLoginAt 排除历史失败实现清零）。
 *
 * @module domain/auth/brute-force
 */
import { db, schema } from '@/infrastructure/db';
import { getRedis } from '@/infrastructure/redis';
import { eq, and, gte, sql } from 'drizzle-orm';

export const BRUTE_FORCE_MAX_ATTEMPTS = 5;
export const BRUTE_FORCE_WINDOW_MINUTES = 15;

const FAIL_COUNT_KEY_PREFIX = 'portal:login_fail:';
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
    // Redis 故障，静默降级到 DB
  }

  // 2. 回退到 DB 查询 (如果 Redis 无法获取计数)
  if (!useRedisCount) {
    try {
      const userRows = await db
        .select({ lastLoginAt: schema.users.lastLoginAt })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      const lastLoginAt = userRows[0]?.lastLoginAt ?? new Date(0);
      const lockWindowStart = new Date(Date.now() - WINDOW_SEC * 1000);
      // DB Fallback 自动清零：仅统计最近成功登录时间之后的失败日志
      const queryStart = lastLoginAt > lockWindowStart ? lastLoginAt : lockWindowStart;

      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.loginLogs)
        .where(
          and(
            eq(schema.loginLogs.userId, userId),
            eq(schema.loginLogs.eventType, 'LOGIN_FAILED'),
            gte(schema.loginLogs.createdAt, queryStart),
          ),
        );
      failCount = result[0]?.count ?? 0;
    } catch (err) {
      // Redis 和 DB 双重不可用，出于安全考量必须 fail-close，阻止登录
      throw new Error('暴力破解防范服务不可用');
    }
  }

  if (failCount >= BRUTE_FORCE_MAX_ATTEMPTS) {
    return { locked: true, message: '登录失败次数过多，账户已临时锁定，请15分钟后重试' };
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
  }
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
    // 清除失败不阻断登录成功流程
  }
}
