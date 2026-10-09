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
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { withScopedWrite } from '@/lib/authz';
import { revokeAllRefreshTokens } from '@/lib/auth/token';
import { clearUserPermissionCache } from '@/lib/permissions';
import { COMMON_ERRORS, USER_PERMISSIONS } from '@auth-sso/contracts';
import { restSuccess, restError } from '@/lib/response';
import { invalidateResource } from '@/lib/cache-invalidation';

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

    // 数据范围守卫：快照与断言同事务（ADR-014 / H-ACL-002）。
    // 原先快照取自事务外，操作者被降权后仍会放行越界下线。
    await withScopedWrite(
      {
        operatorId: adminUserId,
        targets: async (tx) => {
          const row = await tx.query.users.findFirst({
            where: eq(schema.users.id, id),
            columns: { deptId: true },
          });
          if (!row) return [];   // 不存在交由下方 404 分支处理
          return [{ deptId: row.deptId, message: '无权操作该用户' }];
        },
      },
      async () => undefined,
    );

    const target = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
      columns: { id: true },
    });
    if (!target) {
      return restError(COMMON_ERRORS.NOT_FOUND, '用户不存在', 404);
    }

    const userId = target.id;

    // 1. 撤销全部 Refresh Token（DB 层）并同步撤销全部 Access Token JTI，
    //    返回本次真实撤销的 JTI 数量。
    //
    //    此前这里在编排层调用之后再单独调一次 `revokeUserAccessByUserId` 作为
    //    计数来源——但该函数是**幂等**的（读完 user_jti 映射即 `del` 消费掉），
    //    第二次必然拿到空映射并返回 0，导致响应里的 revokedJtiCount 恒为 0。
    const revokedJtiCount = await revokeAllRefreshTokens(userId);

    // 3. 清除权限缓存，确保下次请求拉取最新权限
    await clearUserPermissionCache(userId);

    // 4. 失效页面缓存与数据缓存（确保用户列表即时反映下线状态）
    invalidateResource('users');

    return restSuccess({
      userId: id,
      revokedJtiCount,
      message: `已强制下线用户 ${id}，撤销 ${revokedJtiCount} 个 Access Token JTI`,
    });
  });
}
