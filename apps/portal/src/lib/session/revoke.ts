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

const JTI_BLOCKLIST_PREFIX = REDIS_KEY_PREFIX.JTI_BLOCKLIST;
const USER_JTI_PREFIX = REDIS_KEY_PREFIX.USER_JTI;

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
    console.error('[Session] 写入 jti 黑名单失败:', error);
  }
}

/**
 * 检查 jti 是否已被撤销（在黑名单中）
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) return false;
    const result = await redis.exists(`${JTI_BLOCKLIST_PREFIX}${jti}`);
    return result === 1;
  } catch (error) {
    console.error('[Session] 查询 jti 黑名单失败:', error);
    return false;
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
    console.error('[Session] 写入 user→jti 映射失败:', error);
  }
}

/**
 * 按用户 ID 撤销其所有 Access Token（jti 黑名单 + 清除映射）
 * 用于管理员封禁账户 / 强制下线场景，与 revokeAllRefreshTokens 互补
 *
 * 从 Redis Hash 读取每个 jti → exp 映射，计算精确剩余 TTL 后写入黑名单，
 * 与单个 revokeJti() 的精度一致。
 *
 * @param userId - 用户内部 ID
 * @returns 撤销的 jti 数量，Redis 不可用时返回 0
 */
export async function revokeUserAccessByUserId(userId: string): Promise<number> {
  try {
    const redis = getRedis();
    if (!redis) return 0;
    const key = `${USER_JTI_PREFIX}${userId}`;

    // HGETALL 返回 {jti: exp_timestamp} 键值对
    const jtiExpMap = await redis.hgetall(key);
    const entries = Object.entries(jtiExpMap);
    if (entries.length === 0) return 0;

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
    return entries.length;
  } catch (error) {
    console.error('[Session] 按用户 ID 撤销 JTI 失败:', error);
    return 0;
  }
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

