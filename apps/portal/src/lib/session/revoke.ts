import 'server-only';

/**
 * jti 黑名单（紧急撤销机制）
 * 用于管理员紧急踢人/封禁账户场景，按 TTL 自动过期
 *
 * ## 双层 Redis Key 设计
 * 1. `portal:jti_blocklist:{jti}` — jti → 黑名单标记（Gateway + Portal 双重校验）
 * 2. `portal:user_jti:{userId}`  — userId → {jti: exp} Hash（管理员按用户 ID 撤销，保留精确 TTL）
 *
 * @module lib/session/revoke
 */
import { getRedis } from '@/infrastructure/redis';
import { decodeJwtPayload } from './jwt';
import { REDIS_KEY_PREFIX } from '@auth-sso/contracts';
import { createLogger } from '@/lib/logger';

const log = createLogger('Session');

const JTI_BLOCKLIST_PREFIX = REDIS_KEY_PREFIX.JTI_BLOCKLIST;
const USER_JTI_PREFIX = REDIS_KEY_PREFIX.USER_JTI;
const USER_BATCH_SIZE = 50;

/**
 * 将指定 jti 加入 Redis 黑名单
 * TTL 设置为 Token 的剩余有效期，避免 Redis 存储无限增长
 */
export async function revokeJti(jti: string, tokenExp: number): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const ttl = Math.max(tokenExp - Math.floor(Date.now() / 1000), 1);
    await redis.setex(`${JTI_BLOCKLIST_PREFIX}${jti}`, ttl, '1');
  } catch (error) {
    log.error('写入 jti 黑名单失败', { error: (error as Error).message });
  }
}

/**
 * 检查 jti 是否已被撤销（在黑名单中），fail-close：Redis 不可用时返回 true
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) return true; // fail-close：Redis 不可用时假定已撤销
    await redis.connect?.();
    const result = await redis.exists(`${JTI_BLOCKLIST_PREFIX}${jti}`);
    return result === 1;
  } catch (error) {
    log.error('查询 jti 黑名单失败，降级返回 true（fail-close）', { error: (error as Error).message });
    return true;
  }
}

/**
 * 记录 userId → jti 映射（签发 Access Token 时调用）
 * 用于管理员按用户 ID 执行紧急撤销，TTL 与 Access Token 对齐
 *
 * 使用 Redis Hash 存储 {jti → exp_timestamp}，确保批量撤销时能计算每个 JTI 的精确剩余 TTL
 *
 * @param userId - 用户内部 ID
 * @param jti    - Access Token 的 JWT ID
 * @param ttl    - 过期秒数（与 Token exp 对齐），也作为 Hash key 的最大存活时间
 */
export async function trackUserJti(userId: string, jti: string, ttl: number): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const key = `${USER_JTI_PREFIX}${userId}`;
    // HSET 存储 {jti → exp_timestamp}，支持多设备/多 Client 并存且保留每个 JTI 的精确过期时间
    await redis.hset(key, jti, String(exp));
    await redis.expire(key, Math.max(ttl, 1));
  } catch (error) {
    log.error('写入 user→jti 映射失败', { error: (error as Error).message });
  }
}

/**
 * 单个用户的撤销结果——**成败可判别**。
 *
 * `revoked` 的 0 有两种含义（"该用户没有活着的 AT" 与 "Redis 出错"），
 * 仅凭数字无法区分。需要据此统计成败的调用方（批量撤销）必须用本类型，
 * 否则会把"全部失败"误报成"全部成功"。
 */
interface UserRevokeOutcome {
  /** 本次写入黑名单的 jti 数量（Redis 不可用时为 0） */
  readonly revoked: number;
  /** 是否未真正执行（Redis 不可用或操作抛错） */
  readonly failed: boolean;
}

/**
 * `revokeUserAccessByUserId` 的实现体，额外回报是否失败。
 *
 * 抽出来的唯一原因：公共函数历史上返回 `number`，而 0 是**多义**的
 * （无 jti / Redis 故障）。批量撤销需要单义信号，故在此暴露 `failed`，
 * 公共签名保持不变（避免为内部需要扩散到 7+ 个既有调用方）。
 */
async function revokeUserAccessByUserIdOutcome(userId: string): Promise<UserRevokeOutcome> {
  try {
    const redis = getRedis();
    if (!redis) return { revoked: 0, failed: true };
    const key = `${USER_JTI_PREFIX}${userId}`;

    // HGETALL 返回 {jti: exp_timestamp} 键值对
    const jtiExpMap = await redis.hgetall(key);
    const entries = Object.entries(jtiExpMap);
    if (entries.length === 0) return { revoked: 0, failed: false };

    const nowSec = Math.floor(Date.now() / 1000);
    const pipeline = redis.pipeline();
    for (const [jti, expStr] of entries) {
      const tokenExp = parseInt(expStr, 10);
      if (isNaN(tokenExp)) continue;
      // 与 revokeJti() 保持完全一致的 TTL 计算方式
      const ttl = Math.max(tokenExp - nowSec, 1);
      pipeline.setex(`${JTI_BLOCKLIST_PREFIX}${jti}`, ttl, '1');
    }
    pipeline.del(key);
    await pipeline.exec();

    return { revoked: entries.length, failed: false };
  } catch (error) {
    log.error('按用户 ID 撤销 JTI 失败', { error: (error as Error).message });
    return { revoked: 0, failed: true };
  }
}

/**
 * 按用户 ID 撤销其所有 Access Token（jti 黑名单 + 清除映射）
 * 用于管理员封禁账户 / 强制下线场景，与 revokeAllRefreshTokens 互补
 *
 * @param userId - 用户内部 ID
 * @returns 撤销的 jti 数量，Redis 不可用时返回 0
 */
export async function revokeUserAccessByUserId(userId: string): Promise<number> {
  return (await revokeUserAccessByUserIdOutcome(userId)).revoked;
}

/**
 * 批量按用户 ID 撤销 Access Token
 * 用于角色权限/数据范围变更等会影响一批用户的场景，确保受影响用户下次请求被强制重登，
 * 从而重走 rotateRefreshToken 拿到最新权限（消除 JWT claims 与缓存的双源不一致）。
 *
 * 每批最多并发 50 个撤销，单个用户失败不影响其他用户。
 *
 * @param userIds 用户 ID 数组
 */
export interface BatchRevokeResult {
  /** 真正完成撤销的用户数 */
  readonly succeeded: number;
  /** 未能撤销的用户数（Redis 不可用或操作抛错） */
  readonly failed: number;
}

export async function revokeUsersAccessByUserId(
  userIds: string[],
): Promise<BatchRevokeResult> {
  if (!userIds || userIds.length === 0) return { succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;
  for (let index = 0; index < userIds.length; index += USER_BATCH_SIZE) {
    // 用**可判别的结果**统计成败，而非 `rejected`。
    //
    // 原先按 `allSettled` 的 rejected 计数是失效的：被调用的
    // `revokeUserAccessByUserId` 整体 try/catch、**永不 reject**（内部出错只记日志
    // 并返回 0），故 failed 恒为 0——"批量撤销成功"恒打印、失败告警永不触发。
    // 这与 `revokeAllRefreshTokens` 曾把"永不失败的调用"当作计数依据属同一形态。
    const results = await Promise.all(
      userIds
        .slice(index, index + USER_BATCH_SIZE)
        .map((id) => revokeUserAccessByUserIdOutcome(id)),
    );
    for (const result of results) {
      if (result.failed) failed += 1;
      else succeeded += 1;
    }
  }

  if (failed > 0) {
    log.warn(`批量撤销 ${userIds.length} 个用户：成功 ${succeeded}、失败 ${failed}`);
  } else {
    log.info(`批量撤销 ${userIds.length} 个用户成功`);
  }
  return { succeeded, failed };
}

/**
 * 撤销某个用户当前 JWT 的 jti（需要先解码获取 jti 和 exp）
 * 用于密码修改、账号封禁等需要强制下线的场景
 */
export async function revokeUserToken(accessToken: string): Promise<void> {
  const payload = decodeJwtPayload(accessToken);
  if (payload?.jti && payload.exp) {
    await revokeJti(payload.jti, payload.exp);
  }
}
