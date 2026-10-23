import 'server-only';

/**
 * 授权请求参数暂存（Redis）
 *
 * authorize 端点未登录时，将 OAuth 授权参数（client_id / redirect_uri /
 * code_challenge / state / nonce 等）序列化存入 Redis，/login URL 只暴露不透明
 * 的 session_id。用户登录后回跳 authorize 时凭 session_id 恢复参数。
 *
 * 设计目的：避免 code_challenge、state、nonce 等敏感参数进入 /login URL
 * （浏览器历史 / Referer 头泄漏）。
 *
 * @module lib/session/auth-request-store
 */
import { getRedis } from '@/infrastructure/redis';
import { COOKIE_NAMES, REDIS_KEY_PREFIX } from '@auth-sso/contracts';
import type { StoredAuthRequest } from '@/domain/auth/types';
import { generateId } from '@/lib/crypto';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthRequestStore');

/** TTL 5 分钟，与 authorization_code 生命周期对齐 */
const AUTH_REQUEST_TTL = 300;

/**
 * 授权请求 ↔ 登录会话的绑定 Cookie 名（H-02）。
 *
 * 仅 Portal 内部使用（Gateway 不消费）；Path=/api/auth 使 login 的 POST 与
 * authorize 的 GET 都会携带它，跨站无法伪造（HttpOnly）。
 *
 * 备注：名称唯一真相源在 `packages/contracts` 的 `COOKIE_NAMES.AUTH_REQUEST_BINDING`。
 */
export const AUTH_REQUEST_BINDING_COOKIE = COOKIE_NAMES.AUTH_REQUEST_BINDING;

/** 绑定 Cookie 与暂存授权请求同生命周期（5 分钟） */
export const AUTH_REQUEST_BINDING_TTL = AUTH_REQUEST_TTL;

/** 生成不可预测的绑定值（128 bit 熵，与 session_id 同源 CSPRNG） */
export function generateAuthRequestBinding(): string {
  return `rb_${generateId(32)}`;
}

/**
 * 暂存授权请求参数到 Redis
 * @param sessionId - authorize 生成的会话 ID
 * @param params - OAuth 授权请求参数
 */
export async function storeAuthRequest(
  sessionId: string,
  params: StoredAuthRequest,
): Promise<void> {
  const key = `${REDIS_KEY_PREFIX.AUTH_REQUEST}${sessionId}`;
  const redis = getRedis();
  await redis.connect();
  await redis.setex(key, AUTH_REQUEST_TTL, JSON.stringify(params));
}

/**
 * 读取并原子删除暂存的授权请求参数（GETDEL）
 *
 * 使用 Redis GETDEL 命令实现「读取 + 删除」原子操作，杜绝并发回跳重复消费
 * 同一 session_id 的竞态窗口（原先 get + 异步 del 之间存在被重复读取的间隙）。
 *
 * @param sessionId - authorize 生成的会话 ID
 * @returns 参数对象；不存在或反序列化失败时返回 null
 */
/**
 * 读取暂存参数但**不删除**（登录端点校验绑定用；authorize 分支 A 仍走 GETDEL 原子消费）。
 */
export async function peekStoredAuthRequest(
  sessionId: string,
): Promise<StoredAuthRequest | null> {
  const key = `${REDIS_KEY_PREFIX.AUTH_REQUEST}${sessionId}`;
  const redis = getRedis();
  await redis.connect();
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuthRequest;
  } catch {
    return null;
  }
}

export async function getStoredAuthRequest(
  sessionId: string,
): Promise<StoredAuthRequest | null> {
  const key = `${REDIS_KEY_PREFIX.AUTH_REQUEST}${sessionId}`;
  const redis = getRedis();
  await redis.connect();
  const raw = await redis.getdel(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuthRequest;
  } catch {
    return null;
  }
}

/**
 * 显式删除暂存的授权请求参数（幂等兜底）
 *
 * 正常流程下 getStoredAuthRequest 已通过 GETDEL 原子删除，无需再调用此函数。
 * 保留供异常恢复 / 回滚场景显式清理使用。幂等：key 不存在时 del 返回 0。
 *
 * @param sessionId - authorize 生成的会话 ID
 */
export function deleteStoredAuthRequest(sessionId: string): void {
  const key = `${REDIS_KEY_PREFIX.AUTH_REQUEST}${sessionId}`;
  getRedis().del(key).catch((e) => {
    log.error('删除授权请求参数失败', { error: (e as Error).message });
  });
}

/**
 * 生成 authorize 会话 ID
 * @returns `as_` 前缀 + 32 位随机 hex（基于 crypto.randomBytes，128 bit 熵）
 */
export function generateSessionId(): string {
  return `as_${generateId(32)}`;
}
