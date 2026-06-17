import 'server-only';

/**
 * Server Component 权限守卫工具
 *
 * 替代每个 page.tsx 中手写的 checkPermission + if (!authorized) 样板。
 * 使用 React.cache() 实现同请求去重——layout 和 page 各自调用时命中缓存，零额外开销。
 *
 * @module lib/auth/require-permission
 */
import { cache } from 'react';
import { headers } from 'next/headers';
import { checkPermission, type PermissionCheckOptions } from './check-permission';

/**
 * 声明当前路由所需权限。
 * 鉴权通过返回 userId，失败返回 null。
 *
 * Layout 用于守卫，Page 如需 userId 可再次调用（React.cache 命中，即时返回）。
 */
export const requirePermission = cache(
  async (options: PermissionCheckOptions): Promise<string | null> => {
    const auth = await checkPermission(await headers(), options);
    return auth.authorized && auth.userId ? auth.userId : null;
  },
);
