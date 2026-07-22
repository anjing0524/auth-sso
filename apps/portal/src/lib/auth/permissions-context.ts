import 'server-only';

/**
 * 令牌签发时的权限上下文解析（中间层，消除循环依赖）
 *
 * 背景：`lib/auth/token.ts` 的 `rotateRefreshToken` 需要调用
 * `lib/permissions.ts`（getUserPermissionContext / cacheUserPermissionContext）和
 * `lib/auth/data-scope.ts`（getUserRoleDeptIds），但 permissions.ts 依赖
 * infrastructure，data-scope 依赖 infrastructure + lib/auth，
 * 直接在 token.ts 顶部静态 import 会形成循环依赖。
 *
 * 本模块作为无循环的中间层，token.ts 静态 import 此模块即可，
 * 由本模块统一聚合两个下游模块的调用。
 *
 * @module lib/auth/permissions-context
 */
import { getUserPermissionContext, cacheUserPermissionContext } from '@/lib/permissions';

/**
 * 解析令牌签发所需的权限上下文并缓存到 Redis
 *
 * 查询用户权限上下文，验证用户存在并将权限上下文写入 Redis 缓存，
 * 供子应用鉴权时零 DB 查询。
 *
 * @param userId 用户 ID
 * @returns true 表示用户存在且权限上下文已缓存；false 表示用户不存在或无权限
 */
export async function resolveTokenClaims(
  userId: string,
): Promise<boolean> {
  const permCtx = await getUserPermissionContext(userId);
  if (!permCtx) return false;
  try {
    await cacheUserPermissionContext(userId, permCtx);
  } catch { /* silent */ }
  return true;
}
