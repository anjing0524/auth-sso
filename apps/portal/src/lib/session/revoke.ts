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
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { hashToken } from '@/lib/crypto';
import { decodeJwtPayload } from './jwt';
import { REDIS_KEY_PREFIX } from '@auth-sso/contracts';
import { createLogger } from '@/lib/logger';

const log = createLogger('Session');

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

    // 同步删除该用户 access_tokens 行（UI 列表一致性）
    // 注意：撤销生效靠上方 Redis jti 黑名单（Gateway 离线验签不查 DB）；删表仅为审计可见性，
    // 失败不阻断撤销（与 trackUserJti 同样的容错策略）。
    try {
      await db.delete(schema.accessTokens).where(eq(schema.accessTokens.userId, userId));
    } catch (e) {
      log.error('删除用户 access_tokens 失败', { error: (e as Error).message });
    }

    return entries.length;
  } catch (error) {
    log.error('按用户 ID 撤销 JTI 失败', { error: (error as Error).message });
    return 0;
  }
}

/**
 * 批量按用户 ID 撤销 Access Token
 * 用于角色权限/数据范围变更等会影响一批用户的场景，确保受影响用户下次请求被强制重登，
 * 从而重走 rotateRefreshToken 拿到最新权限（消除 JWT claims 与缓存的双源不一致）。
 *
 * 并行撤销，单个用户失败不影响其他用户。
 *
 * @param userIds 用户 ID 数组
 */
export async function revokeUsersAccessByUserId(userIds: string[]): Promise<void> {
  if (!userIds || userIds.length === 0) return;
  const results = await Promise.allSettled(userIds.map((id) => revokeUserAccessByUserId(id)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    log.warn(`批量撤销 ${userIds.length} 个用户，${failed} 个失败`);
  } else {
    log.info(`批量撤销 ${userIds.length} 个用户成功`);
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
  // 同步删除 access_tokens 行（登出场景，单 token 撤销）；失败不阻断撤销
  try {
    await db.delete(schema.accessTokens).where(eq(schema.accessTokens.tokenHash, hashToken(accessToken)));
  } catch (e) {
    log.error('删除 access_tokens 失败', { error: (e as Error).message });
  }
}

