/**
 * 管理员强制下线 API (POST /api/users/[id]/force-logout)
 *
 * 撤销用户全部 Refresh Token（DB revoked 标记）和 Access Token JTI（Redis 黑名单），
 * 并清除权限缓存，实现完整的强制登出闭环。
 *
 * 权限要求: user:manage
 *
 * @route POST /api/users/[id]/force-logout
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { forceLogoutUser } from '@/lib/auth/force-logout';
import { clearUserPermissionCache } from '@/lib/permissions';
import { USER_PERMISSIONS } from '@auth-sso/contracts';
import { restSuccess } from '@/lib/response';
import { invalidateResourceFromRoute } from '@/lib/cache-invalidation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/users/[id]/force-logout
 * 强制下线指定用户，同时撤销 Refresh Token + Access Token JTI
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams,
) {
  return withPermission({ permissions: [USER_PERMISSIONS.MANAGE] }, async (adminUserId) => {
    const { id } = await params;

    // 数据范围守卫 + 目标读取 + 撤销（共享实现，Server Action 复用）
    const jti = await forceLogoutUser(adminUserId, id);

    // 2. 清除权限缓存，确保下次请求拉取最新权限
    await clearUserPermissionCache(id);

    // 3. 失效页面缓存与数据缓存（确保用户列表即时反映下线状态）
    //    Route Handler 必须用 route 版入口：`invalidateResource` 走 `updateTag`，
    //    而该原语在 route 上下文必抛（Next.js E872）——抛出点在撤销已提交之后，
    //    会造成"写成功、失效未发生、响应 5xx"并诱使调用方重试。
    invalidateResourceFromRoute('users');

    return restSuccess({
      userId: id,
      revokedJtiCount: jti.revokedJtiCount,
      // jti 层永不抛出，"没撤成"只能经返回值回报：不报的话，revokedJtiCount 的 0
      // 既可能是"该用户没有活着的 AT"，也可能是"Redis 不可用、一个都没撤成"。
      jtiRevocationFailed: jti.jtiRevocationFailed,
      message: jti.jtiRevocationFailed
        ? `已强制下线用户 ${id}；Access Token 撤销未能执行（Redis 不可用），旧 AT 在自然过期前仍然有效`
        : `已强制下线用户 ${id}，撤销 ${jti.revokedJtiCount} 个 Access Token JTI`,
    });
  });
}
