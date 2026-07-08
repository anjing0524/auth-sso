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
import { REDIS_KEY_PREFIX } from '@auth-sso/contracts';
import type { StoredAuthRequest } from '@/domain/auth/types';
import { generateId } from '@/lib/crypto';

/** TTL 5 分钟，与 authorization_code 生命周期对齐 */
const AUTH_REQUEST_TTL = 300;

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
  await getRedis().setex(key, AUTH_REQUEST_TTL, JSON.stringify(params));
}

/**
 * 读取暂存的授权请求参数
 * @param sessionId - authorize 生成的会话 ID
 * @returns 参数对象；不存在或反序列化失败时返回 null
 */
export async function getStoredAuthRequest(
  sessionId: string,
): Promise<StoredAuthRequest | null> {
  const key = `${REDIS_KEY_PREFIX.AUTH_REQUEST}${sessionId}`;
  const raw = await getRedis().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuthRequest;
  } catch {
    return null;
  }
}

/**
 * 删除暂存的授权请求参数（一次性消费：签发 code 后立即调用）
 *
 * fire-and-forget：删除失败不影响主流程（key 有 5min TTL 会自动过期）。
 * @param sessionId - authorize 生成的会话 ID
 */
export function deleteStoredAuthRequest(sessionId: string): void {
  const key = `${REDIS_KEY_PREFIX.AUTH_REQUEST}${sessionId}`;
  getRedis().del(key).catch((e) => {
    console.error('[AuthRequestStore] 删除授权请求参数失败:', e);
  });
}

/**
 * 生成 authorize 会话 ID
 * @returns `as_` 前缀 + 32 位随机 hex（基于 crypto.randomBytes，128 bit 熵）
 */
export function generateSessionId(): string {
  return `as_${generateId(32)}`;
}
