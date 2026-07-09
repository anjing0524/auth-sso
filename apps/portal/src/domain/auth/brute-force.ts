import 'server-only';

/**
 * 暴力破解防护模块
 *
 * 使用 Redis INCR 原子计数（优先）+ DB login_logs 查询（回退）检测登录暴力破解。
 * Redis 不可用时自动回退到 DB 查询（fail-open 策略）。
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
 * 检查登录暴力破解锁定状态
 *
 * 流程：Redis INCR（优先）→ DB login_logs 查询（回退）→ 次数比对 → 返回锁定判定。
 * Redis 不可用时自动 fail-open 回退到 DB 查询；DB 也不可用时安全放行。
 *
 * 调用方（login/route.ts）应先通过 email 查询用户，获得 userId 后再调用本函数，
 * 避免本函数内重复查询用户表（热路径优化）。
 *
 * @param userId 用户 ID（由调用方提前通过 email 查询获得）
 * @returns 锁定状态与提示消息
 */
export async function checkBruteForce(
  userId: string,
): Promise<{ locked: boolean; message?: string }> {
  const failCountKey = `${FAIL_COUNT_KEY_PREFIX}${userId}`;
  let failCount = 0;
  let useRedisCount = false;

  // 优先路径：Redis INCR 原子计数（消除 DB 查询与密码校验之间的 TOCTOU 竞态窗口）
  try {
    const redis = getRedis();
    if (redis) {
      const count = await redis.incr(failCountKey);
      if (count === 1) {
        await redis.expire(failCountKey, WINDOW_SEC);
      }
      useRedisCount = true;
      failCount = count;
    }
  } catch {
    // Redis 不可用，回退到 DB 查询
  }

  // 回退路径：查询 login_logs 表（非原子操作，仅作为降级方案）
  if (!useRedisCount) {
    try {
      const lockWindowStart = new Date(Date.now() - WINDOW_SEC * 1000);
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.loginLogs)
        .where(
          and(
            eq(schema.loginLogs.userId, userId),
            eq(schema.loginLogs.eventType, 'LOGIN_FAILED'),
            gte(schema.loginLogs.createdAt, lockWindowStart),
          ),
        );
      failCount = result[0]?.count ?? 0;
    } catch {
      // login_logs 表不可用（测试环境 mock 不完整等场景），安全放行
    }
  }

  if (failCount >= BRUTE_FORCE_MAX_ATTEMPTS) {
    return { locked: true, message: '登录失败次数过多，账户已临时锁定，请15分钟后重试' };
  }

  return { locked: false };
}

/**
 * 密码验证成功后清除暴力破解计数器
 *
 * @param userId 用户 ID
 */
export async function clearBruteForceCounter(userId: string): Promise<void> {
  try {
    const redis = getRedis();
    redis?.del(`${FAIL_COUNT_KEY_PREFIX}${userId}`);
  } catch {
    // 清除失败不影响登录流程
  }
}
