import 'server-only';

/**
 * 暴力破解防护模块（H-03 / H-04.a 修订：账户 + IP 双维度）
 *
 * ## 为什么改（2026-10-23 质量审计 H-03/H-04）
 *
 * 旧实现只有一个**按 userId** 的失败计数器：5 次错误即锁定该账户 15 分钟。
 * 两个问题：
 * 1. **定向 DoS**：攻击者只要知道邮箱，连发 5 次错误密码就能把受害者锁在门外
 *    （H-04.a）；且"锁定"只存在于 Redis，`users.status` 恒为 ACTIVE，管理员在 UI 上
 *    的"解锁"按钮对这类锁定不可达（H-03）。
 * 2. **无 IP 维度**：不存在邮箱的尝试完全不计入任何限流（用户枚举无成本，#H-04）。
 *
 * ## 新策略（ADR-025）
 *
 * | 维度 | 键 | 阈值 | 结果 |
 * |---|---|---|---|
 * | 账户 × 客户端 IP | `portal:login_fail:<userId>:<ip>` | 5 次 / 15min | 423 ACCOUNT_LOCKED |
 * | 客户端 IP | `portal:login_fail_ip:<ip>` | 20 次 / 15min | 429 RATE_LIMITED |
 *
 * - 账户锁键含 IP ⇒ 单个 IP 无法把受害者的账户锁给所有人（同一 IP 仍会收到 423，
 *   但受害者从别的 IP 可正常登录）；
 * - 每次失败同时递增 IP 计数 ⇒ 分布式低速尝试也受 IP 总量约束；不存在邮箱只计 IP，
 *   使枚举有成本；
 * - 成功登录清除该（账户,IP）的账户计数；管理员解锁清除该用户的**全部**账户计数；
 * - Redis 不可用时回退 DB（`login_logs` 同时含 userId 与 ip），语义与 Redis 路径一致。
 *
 * @module lib/auth/brute-force
 */
import { db, schema } from '@/infrastructure/db';
import { getRedis } from '@/infrastructure/redis';
import { eq, and, gte, count, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { REDIS_KEY_PREFIX } from '@auth-sso/contracts';

const log = createLogger('BruteForce');

// ── 配置（可注入，供测试使用）─────────────────────────────────────────

export interface BruteForceConfig {
  /** 账户 × IP 维度：窗口内允许的失败次数 */
  maxAttempts: number;
  /** 账户 × IP 维度窗口（分钟） */
  windowMinutes: number;
  /** IP 维度：窗口内允许的失败次数（跨账户累计） */
  ipMaxAttempts: number;
  /** IP 维度窗口（分钟） */
  ipWindowMinutes: number;
}

const DEFAULT_BRUTE_FORCE_CONFIG: BruteForceConfig = {
  maxAttempts: 5,
  windowMinutes: 15,
  ipMaxAttempts: 20,
  ipWindowMinutes: 15,
};

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return parsed > 0 ? parsed : fallback;
}

const BRUTE_FORCE_MAX_ATTEMPTS = positiveIntEnv('BRUTE_FORCE_MAX_ATTEMPTS', DEFAULT_BRUTE_FORCE_CONFIG.maxAttempts);
const BRUTE_FORCE_WINDOW_MINUTES = positiveIntEnv('BRUTE_FORCE_WINDOW_MINUTES', DEFAULT_BRUTE_FORCE_CONFIG.windowMinutes);
const BRUTE_FORCE_IP_MAX_ATTEMPTS = positiveIntEnv('BRUTE_FORCE_IP_MAX_ATTEMPTS', DEFAULT_BRUTE_FORCE_CONFIG.ipMaxAttempts);
const BRUTE_FORCE_IP_WINDOW_MINUTES = positiveIntEnv('BRUTE_FORCE_IP_WINDOW_MINUTES', DEFAULT_BRUTE_FORCE_CONFIG.ipWindowMinutes);

/** IP 缺失时统一占位，保证键形状稳定（不产生裸的 `portal:login_fail:`） */
function normalizeIp(ip: string | null | undefined): string {
  return ip && ip.length > 0 ? ip : 'unknown';
}

/** 账户 × IP 计数键（导出让测试/管理工具使用同一形态） */
export function bruteForceAccountKey(userId: string, ip: string): string {
  return `${REDIS_KEY_PREFIX.LOGIN_FAIL}${userId}:${normalizeIp(ip)}`;
}

/** IP 维度计数键 */
export function bruteForceIpKey(ip: string): string {
  return `${REDIS_KEY_PREFIX.LOGIN_FAIL_IP}${normalizeIp(ip)}`;
}

function resolveConfig(config?: BruteForceConfig): BruteForceConfig {
  return config ?? {
    maxAttempts: BRUTE_FORCE_MAX_ATTEMPTS,
    windowMinutes: BRUTE_FORCE_WINDOW_MINUTES,
    ipMaxAttempts: BRUTE_FORCE_IP_MAX_ATTEMPTS,
    ipWindowMinutes: BRUTE_FORCE_IP_WINDOW_MINUTES,
  };
}

/** 读 Redis 计数（不可用时返回 null 表示需要回退 DB） */
async function readRedisCounts(keys: { account?: string; ip: string }): Promise<{ account: number; ip: number } | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const [accountRaw, ipRaw] = await Promise.all([
      keys.account ? redis.get(keys.account) : Promise.resolve(null),
      redis.get(keys.ip),
    ]);
    return {
      account: accountRaw ? parseInt(accountRaw, 10) : 0,
      ip: ipRaw ? parseInt(ipRaw, 10) : 0,
    };
  } catch (err) {
    log.warn('Redis 不可用，降级到 DB 查询', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** DB 回退：窗口内的失败次数（账户×IP / 纯 IP 两种口径） */
async function readDbCounts(
  userId: string | null,
  ip: string,
  config: BruteForceConfig,
): Promise<{ account: number; ip: number }> {
  const accountWindowStart = new Date(Date.now() - config.windowMinutes * 60 * 1000);
  const ipWindowStart = new Date(Date.now() - config.ipWindowMinutes * 60 * 1000);
  const ipCondition = ip === 'unknown'
    ? sql`${schema.loginLogs.ip} IS NULL`
    : eq(schema.loginLogs.ip, ip);
  try {
    const accountQuery = userId
      ? db
        .select({ count: count() })
        .from(schema.loginLogs)
        .where(
          and(
            eq(schema.loginLogs.userId, userId),
            eq(schema.loginLogs.eventType, 'LOGIN_FAILED'),
            ipCondition,
            gte(
              schema.loginLogs.createdAt,
              sql<Date>`GREATEST(
                ${accountWindowStart.toISOString()}::timestamptz,
                COALESCE(
                  (SELECT last_login_at FROM users WHERE id = ${userId} LIMIT 1),
                  '-infinity'::timestamptz
                )
              )`,
            ),
          ),
        )
      : Promise.resolve([{ count: 0 }]);
    const [accountRows, ipRows] = await Promise.all([
      accountQuery,
      db
        .select({ count: count() })
        .from(schema.loginLogs)
        .where(
          and(
            eq(schema.loginLogs.eventType, 'LOGIN_FAILED'),
            ipCondition,
            gte(schema.loginLogs.createdAt, ipWindowStart),
          ),
        ),
    ]);
    return { account: accountRows[0]?.count ?? 0, ip: ipRows[0]?.count ?? 0 };
  } catch {
    throw new Error('暴力破解防范服务不可用');
  }
}

/**
 * 检查 IP 维度限流（**先于查库**调用：让枚举与撞库在触达用户表前被削峰）。
 *
 * @returns 命中限流时返回提示消息；未命中返回 null
 */
export async function checkIpRateLimit(ip: string, config?: BruteForceConfig): Promise<string | null> {
  const cfg = resolveConfig(config);
  const counts = await readRedisCounts({ ip: bruteForceIpKey(ip) });
  const ipCount = counts ? counts.ip : (await readDbCounts(null, ip, cfg)).ip;
  if (ipCount >= cfg.ipMaxAttempts) {
    return `来自该 IP 的登录失败次数过多，请 ${cfg.ipWindowMinutes} 分钟后重试`;
  }
  return null;
}

/**
 * 检查账户×IP 锁定状态（只读，无 side-effect）。
 */
export async function checkBruteForce(
  userId: string,
  ip: string,
  config?: BruteForceConfig,
): Promise<{ locked: boolean; message?: string; rateLimited?: boolean; retryAfterSeconds?: number }> {
  const cfg = resolveConfig(config);
  const keys = { account: bruteForceAccountKey(userId, ip), ip: bruteForceIpKey(ip) };

  const redisCounts = await readRedisCounts(keys);
  let accountCount: number;
  let ipCount: number;
  if (redisCounts) {
    accountCount = redisCounts.account;
    ipCount = redisCounts.ip;
  } else {
    const dbCounts = await readDbCounts(userId, ip, cfg);
    accountCount = dbCounts.account;
    ipCount = dbCounts.ip;
  }

  // IP 维度先判：被限流的来源即使密码正确也不应继续消耗账户计数
  if (ipCount >= cfg.ipMaxAttempts) {
    return {
      locked: false,
      rateLimited: true,
      message: `来自该 IP 的登录失败次数过多，请 ${cfg.ipWindowMinutes} 分钟后重试`,
      retryAfterSeconds: cfg.ipWindowMinutes * 60,
    };
  }
  if (accountCount >= cfg.maxAttempts) {
    return {
      locked: true,
      message: `登录失败次数过多，账户已临时锁定，请${cfg.windowMinutes}分钟后重试`,
      retryAfterSeconds: cfg.windowMinutes * 60,
    };
  }
  return { locked: false };
}

/** 递增失败计数：传 userId 时账户×IP 与 IP 两个维度都加，传 null 时只加 IP 维度 */
export async function incrementBruteForce(
  userId: string | null,
  ip: string,
  config?: BruteForceConfig,
): Promise<void> {
  const cfg = resolveConfig(config);
  const keys = userId
    ? [bruteForceAccountKey(userId, ip), bruteForceIpKey(ip)]
    : [bruteForceIpKey(ip)];
  try {
    const redis = getRedis();
    if (redis) {
      for (const key of keys) {
        const count = await redis.incr(key);
        if (count === 1) {
          const windowMinutes = key.startsWith(REDIS_KEY_PREFIX.LOGIN_FAIL_IP)
            ? cfg.ipWindowMinutes
            : cfg.windowMinutes;
          await redis.expire(key, windowMinutes * 60);
        }
      }
    }
  } catch (err) {
    log.warn('递增计数失败（Redis 故障）', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * 清除某个（账户, IP）的账户计数（登录成功时调用）。
 *
 * 只清账户维度：IP 维度计数用于发现"同一来源撞多个账户"，不应因单次成功被洗白。
 */
export async function clearBruteForceCounter(userId: string, ip: string): Promise<void> {
  try {
    const redis = getRedis();
    if (redis) {
      await redis.del(bruteForceAccountKey(userId, ip));
    }
  } catch (err) {
    log.warn('清除计数器失败（Redis 故障）', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * 清除某用户**全部 IP** 的账户计数（管理员解锁时调用，H-03）。
 *
 * 用 SCAN 遍历 `<prefix><userId>:*`（以及旧格式裸键 `<prefix><userId>` 兜底），
 * 避免 KEYS 阻塞 Redis。
 */
export async function clearUserBruteForceCounters(userId: string): Promise<number> {
  let removed = 0;
  try {
    const redis = getRedis();
    if (!redis) return 0;
    const pattern = `${REDIS_KEY_PREFIX.LOGIN_FAIL}${userId}:*`;
    if (typeof redis.scan === 'function') {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) {
          removed += await redis.del(...keys);
        }
      } while (cursor !== '0');
    } else {
      // 类型上 scan 是可选能力（测试替身/极简实现可能没有）：管理面低频路径退化到 KEYS
      const keys = await redis.keys(pattern);
      if (keys.length > 0) removed += await redis.del(...keys);
    }
    // 旧键（无 IP 维度时写入）：解锁时一并清理，避免滚动升级窗口内残留
    removed += await redis.del(`${REDIS_KEY_PREFIX.LOGIN_FAIL}${userId}`);
  } catch (err) {
    log.warn('批量清除账户计数失败（Redis 故障）', { error: err instanceof Error ? err.message : String(err) });
  }
  return removed;
}
