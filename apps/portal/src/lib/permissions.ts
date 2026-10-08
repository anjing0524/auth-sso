/**
 * 权限上下文工具函数
 * 获取用户的角色和权限，具备高性能的 Redis 旁路缓存支持
 */
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { getRedis, type RedisClient } from '@/infrastructure/redis';
import { ENTITY_ACTIVE, REDIS_KEY_PREFIX } from '@auth-sso/contracts';
import type { UserPermissionContext } from '@auth-sso/contracts';
import { createLogger } from '@/lib/logger';
import { randomInt } from 'crypto';

const log = createLogger('PermissionContext');

/** 权限缓存基准 TTL，与 Access Token TTL (3600s) 对齐 */
const PERM_CACHE_TTL_BASE = 3600;
/** TTL 随机抖动范围（±秒），防止大量 Token 同时签发导致缓存同时过期引发雪崩 */
const PERM_CACHE_TTL_JITTER = 300;
/** 用户不存在时缓存 null 标记的 TTL（防穿透枚举） */
const NULL_CACHE_TTL = 60;
/** null 标记的 Redis Key 后缀 */
const NULL_CACHE_SUFFIX = ':null';
/**
 * 瞬时故障标记的 Redis Key 后缀与 TTL。
 *
 * 与 `:null`（用户不存在，60s）刻意分开：把"DB 抖动"缓存成"用户不存在"会让
 * 一个瞬时故障固化成 60 秒的拒绝。但完全不缓存又会在 DB 抖动时让同用户的
 * 重试全部穿透到 DB（雪崩）。5 秒是"吸收重试风暴、又不把故障当真"的折中。
 */
const UNAVAILABLE_CACHE_SUFFIX = ':unavailable';
const UNAVAILABLE_CACHE_TTL = 5;
const USER_BATCH_SIZE = 50;

async function settleUserBatches(
  userIds: string[],
  operation: (userId: string) => Promise<void>,
): Promise<number> {
  let failed = 0;
  for (let index = 0; index < userIds.length; index += USER_BATCH_SIZE) {
    const results = await Promise.allSettled(userIds.slice(index, index + USER_BATCH_SIZE).map(operation));
    failed += results.filter((result) => result.status === 'rejected').length;
  }
  return failed;
}

/**
 * 计算带随机抖动的缓存 TTL，防止缓存雪崩。
 * 返回 [base - jitter, base + jitter] 区间内的随机秒数。
 */
function jitteredCacheTtl(): number {
  const delta = randomInt(-PERM_CACHE_TTL_JITTER, PERM_CACHE_TTL_JITTER + 1);
  return PERM_CACHE_TTL_BASE + delta;
}

// Re-export 以便其他模块统一导入
export type { UserPermissionContext };

/**
 * 静默写入 Redis 缓存（失败不影响主流程）。
 */
async function safeSetCache(
  redis: RedisClient,
  key: string,
  ttl: number,
  value: string,
  userId: string,
): Promise<void> {
  try {
    await redis.setex(key, ttl, value);
  } catch (e) {
    log.warn(`Redis cache write failed for user ${userId}`, { error: (e as Error).message });
  }
}

/**
 * 获取用户的权限上下文
 * 优先读取 Redis 缓存，未命中则查询数据库并写入缓存 (TTL: 3600s，与 Access Token 对齐)
 * 具备优雅的降级机制，若 Redis 连接异常则直接回退为数据库查询，保证服务高可用
 *
 * Token 签发时已通过 cacheUserPermissionContext 主动预填充缓存，
 * 正常情况下总是 Redis 命中，零 DB 查询。
 */
/**
 * 权限上下文解析结果。
 *
 * 原先返回 `UserPermissionContext | null`，把**三种语义完全不同**的失败压成同一个
 * `null`（见 ADR-018）：
 * - `not_found` / `inactive` —— 必须拒绝（否决性数据）
 * - `unavailable` —— 基础设施故障，按 ADR-011 属缓存性数据，**调用方应降级而非拒绝**
 *
 * 压成 `null` 的直接后果：`rotateRefreshToken` 只能把 DB 抖动当成"上下文不可用"
 * 而 fail-close 登出用户。调用方无从分级，是因为 interface 没给它们分级的信息。
 */
export type UserPermissionContextResult =
  | { readonly kind: 'ok'; readonly context: UserPermissionContext }
  /** 用户不存在或非 ACTIVE —— 否决性数据，调用方必须拒绝 */
  | { readonly kind: 'denied'; readonly reason: 'not_found' | 'inactive' }
  /** 数据库不可用 —— **不构成判据**，调用方应按 ADR-011 降级 */
  | { readonly kind: 'unavailable' };

export async function getUserPermissionContext(userId: string): Promise<UserPermissionContextResult> {
  const cacheKey = `${REDIS_KEY_PREFIX.USER_PERMS}${userId}`;
  let redis: RedisClient | null = null;

  // 1. 尝试从 Redis 缓存中获取数据
  try {
    redis = getRedis();
    // 防穿透：先检查 null 标记（用户不存在时缓存的短 TTL 占位）
    // 先查瞬时故障标记：命中说明刚刚 DB 不可用，短暂短路避免重试风暴
    if (await redis.get(`${cacheKey}${UNAVAILABLE_CACHE_SUFFIX}`) !== null) {
      return { kind: 'unavailable' };
    }
    // 防穿透：null 标记表示用户不存在
    if (await redis.get(`${cacheKey}${NULL_CACHE_SUFFIX}`) !== null) {
      return { kind: 'denied', reason: 'not_found' };
    }
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return { kind: 'ok', context: JSON.parse(cachedData) as UserPermissionContext };
    }
  } catch (cacheError: unknown) {
    // 降级容错：Redis 异常时不阻断核心鉴权业务，仅记录日志并继续查库
    log.warn(`Redis cache read failed for user ${userId}, falling back to DB`, { error: (cacheError as Error).message });
  }

  try {
    // 2. 从数据库级联查询用户、绑定的角色以及各角色的权限列表，降低 DB 往返开销。
    // 使用 columns 仅选必要字段，减少 4 层嵌套关联的数据传输量。
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { id: true, status: true },
      with: {
        userRoles: {
          columns: { roleId: true },
          with: {
            role: {
              columns: { id: true, code: true, name: true, deptId: true, status: true },
              with: {
                rolePermissions: {
                  columns: { permissionId: true },
                  with: {
                    permission: {
                      columns: { id: true, code: true, status: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      // 防穿透：缓存 null 标记，避免不存在的 userId 每次都穿透到 DB（60s TTL）
      if (redis) {
        await safeSetCache(redis, `${cacheKey}${NULL_CACHE_SUFFIX}`, NULL_CACHE_TTL, '1', userId);
      }
      return { kind: 'denied', reason: 'not_found' };
    }

    // 强核准状态约束：非 ACTIVE 立刻拒绝，防范封禁账号鉴权逃逸漏洞
    if (user.status !== ENTITY_ACTIVE) {
      log.warn(`Access denied: User ${userId} is not ACTIVE`, { status: user.status });
      return { kind: 'denied', reason: 'inactive' };
    }

    // 从嵌套结构中过滤出处于激活状态 (ACTIVE) 的角色
    const roles = user.userRoles
      .map(ur => ur.role)
      .filter((r): r is NonNullable<typeof r> => r !== null && r.status === ENTITY_ACTIVE);

    if (roles.length === 0) {
      const context: UserPermissionContext = {
        roles: [],
        permissions: [],
        deptIds: [],
      };

      // 写入缓存并直接返回
      if (redis) {
        await safeSetCache(redis, cacheKey, jitteredCacheTtl(), JSON.stringify(context), userId);
      }
      return { kind: 'ok', context };
    }

    // 从激活角色拥有的权限中过滤出激活状态的权限 code（进行去重处理）
    const activePermissionCodes = Array.from(
      new Set(
        roles
          .flatMap(r => r.rolePermissions)
          .map(rp => rp.permission)
          .filter((p): p is NonNullable<typeof p> => p !== null && p.status === ENTITY_ACTIVE)
          .map(p => p.code)
      )
    );

    // v3.2: 收集所有角色的所属部门 ID，去重（子树展开在 Token 签发 / getUserRoleDeptIds 时完成）
    const deptIds = Array.from(
      new Set(
        roles
          .map(r => r.deptId)
          .filter((id): id is string => !!id),
      ),
    );

    const context: UserPermissionContext = {
      roles: roles.map(r => ({
        id: r.id,
        code: r.code,
        name: r.name,
      })),
      permissions: activePermissionCodes,
      deptIds,
    };

    // 将结果回写至 Redis 缓存，TTL 与 Access Token 对齐
    if (redis) {
      await safeSetCache(redis, cacheKey, jitteredCacheTtl(), JSON.stringify(context), userId);
    }

    return { kind: 'ok', context };
  } catch (error: unknown) {
    log.error('Database query error', { error: (error as Error).message });
    // 瞬时故障标记：短 TTL 吸收重试风暴，但**不**写成 `:null`——那会把瞬时故障
    // 固化成 60 秒的"用户不存在"（ADR-011 / ADR-018）。
    if (redis) {
      await safeSetCache(redis, `${cacheKey}${UNAVAILABLE_CACHE_SUFFIX}`, UNAVAILABLE_CACHE_TTL, '1', userId);
    }
    return { kind: 'unavailable' };
  }
}

/**
 * 把解析结果收窄为**判定语义**：有上下文返回它，否则 null。
 *
 * 判定场景（鉴权、权限码检查、页面渲染）不区分 `denied` 与 `unavailable`——
 * 两者都不构成授权依据，都拒绝。**降级决策集中在此一处**，而不是散落到
 * 每个调用点各自判断（那正是 ADR-018 要消除的形状）。
 *
 * 仅当调用方确实要为基础设施故障保留"非否决"语义时（如 token 签发后的
 * 缓存预填充），才应直接消费 {@link UserPermissionContextResult}。
 */
export function toPermissionContextOrNull(
  result: UserPermissionContextResult,
): UserPermissionContext | null {
  return result.kind === 'ok' ? result.context : null;
}

/**
 * 主动刷新指定用户的权限上下文缓存。
 * 先删旧缓存 → 查 DB 获取最新数据 → 写入 Redis。
 * 用于管理员修改用户角色/权限/部门后立即同步缓存，确保受影响用户下次请求零 DB 命中。
 *
 * @param userId 用户 ID
 */
export async function refreshUserPermissionCache(userId: string): Promise<void> {
  try {
    const redis = getRedis();
    const cacheKey = `${REDIS_KEY_PREFIX.USER_PERMS}${userId}`;
    // 1. 删除旧缓存 + null 标记，强制走 DB 获取最新数据
    await redis.del(cacheKey, `${cacheKey}${NULL_CACHE_SUFFIX}`);
    // 2. 查 DB → 自动回写 Redis（TTL 带随机抖动）
    const ctx = await getUserPermissionContext(userId);
    if (ctx) {
      log.info('Refreshed cache for user', { userId });
    }
  } catch (error: unknown) {
    log.error('Failed to refresh cache for user', { userId, error: (error as Error).message });
  }
}

/**
 * 批量主动刷新指定用户的权限上下文缓存
 * @param userIds 用户 ID 数组
 */
export async function refreshUsersPermissionCache(userIds: string[]): Promise<void> {
  if (!userIds || userIds.length === 0) return;
  const failed = await settleUserBatches(userIds, refreshUserPermissionCache);
  log.info(`Refreshed cache for ${userIds.length} users`, { failed });
}

/**
 * 清除指定用户的权限上下文缓存（仅删除，不重新填充）
 * 保留用于强制下线等不需要立即回填的场景
 * @param userId 用户 ID
 */
export async function clearUserPermissionCache(userId: string): Promise<void> {
  try {
    const redis = getRedis();
    const cacheKey = `${REDIS_KEY_PREFIX.USER_PERMS}${userId}`;
    // 同时删除 null 标记，确保下次查询重新走 DB
    await redis.del(cacheKey, `${cacheKey}${NULL_CACHE_SUFFIX}`);
    log.info('Cleared permissions cache for user', { userId });
  } catch (error: unknown) {
    log.error('Failed to clear permission cache for user', { userId, error: (error as Error).message });
  }
}

/**
 * 主动将权限上下文写入 Redis 缓存，TTL 与 Access Token 对齐。
 * 在 Token 签发（login / refresh_token grant）时调用，确保后续请求总是 Redis 命中。
 *
 * @param userId - 用户内部 ID
 * @param ctx     - 完整的权限上下文
 * @param ttl     - 缓存基准过期秒数，实际写入时叠加 ±jitter 抖动防雪崩
 */
export async function cacheUserPermissionContext(
  userId: string,
  ctx: UserPermissionContext,
  ttl?: number,
): Promise<void> {
  // 预填充缓存是尽力而为：getRedis() 抛错（Redis 不可用）与 setex 失败同属
  // 缓存性故障，不应让 Token 签发/轮换整体失败（ADR-011 缓存性数据 fail-open）
  try {
    const redis = getRedis();
    const cacheKey = `${REDIS_KEY_PREFIX.USER_PERMS}${userId}`;
    await safeSetCache(redis, cacheKey, ttl ?? jitteredCacheTtl(), JSON.stringify(ctx), userId);
  } catch (error: unknown) {
    log.warn(`Skipped permission cache prefill for user ${userId}`, { error: (error as Error).message });
  }
}
