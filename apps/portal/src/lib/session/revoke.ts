import 'server-only';

/**
 * jti 黑名单（紧急撤销机制）
 * 用于管理员紧急踢人/封禁账户场景，按 TTL 自动过期
 *
 * @module lib/session/revoke
 */
import { getRedis } from '@/infrastructure/redis';
import { decodeJwtPayload } from './jwt';
import { getJwtFromCookie } from './cookies';

const JTI_BLOCKLIST_PREFIX = 'portal:jti_blocklist:';

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
 * 撤销某个用户当前 JWT 的 jti（需要先解码获取 jti 和 exp）
 * 用于密码修改、账号封禁等需要强制下线的场景
 */
export async function revokeUserToken(accessToken: string): Promise<void> {
  const payload = decodeJwtPayload(accessToken);
  if (payload?.jti && payload.exp) {
    await revokeJti(payload.jti, payload.exp);
  }
}

/**
 * @deprecated 已迁移至 JWT Cookie 架构，请使用 getJwtFromCookie()
 */
export async function getSessionIdFromCookie(): Promise<string | null> {
  return getJwtFromCookie();
}
