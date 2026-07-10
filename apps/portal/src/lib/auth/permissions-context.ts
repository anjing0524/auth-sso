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
import { getUserPermissionContext } from '@/lib/permissions';
import { getUserRoleDeptIds } from '@/lib/auth/data-scope';
import type { PortalJwtClaims } from '@/domain/auth/types';
import type { UserPermissionContext } from '@auth-sso/contracts';

/**
 * 解析令牌签发所需的权限上下文（角色权限码 + 部门 ID 子树展开）
 *
 * 并行查询权限缓存与数据范围，供 signAccessToken 使用。
 *
 * @param userId 用户 ID
 * @returns 角色权限码列表 + 部门 ID 列表（含子树展开）；用户不存在或无权限时返回 null
 */
export async function resolveTokenClaims(
  userId: string,
): Promise<{ permCtx: UserPermissionContext; deptIds: string[] } | null> {
  const [permCtx, deptIds] = await Promise.all([
    getUserPermissionContext(userId),
    getUserRoleDeptIds(userId),
  ]);
  if (!permCtx) return null;
  return { permCtx, deptIds };
}

/**
 * 类型便捷导出：令牌 claims 所需的权限子集
 */
export type TokenClaims = Pick<PortalJwtClaims, 'sub' | 'roles' | 'permissions' | 'deptIds'>;
