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
import { schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { withScopedRow } from '@/lib/authz';
import { revokeAllRefreshTokens } from '@/lib/auth/token';
import { clearUserPermissionCache } from '@/lib/permissions';
import { EntityNotFoundError } from '@/domain/shared/errors';
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

    // 数据范围守卫 + 目标读取 + 撤销，**全部在同一事务内**（ADR-014 / H-ACL-002）。
    //
    // 2026-10-13 修订（架构评审 R2 候选 R11）：此前守卫写成
    // `withScopedWrite({...}, async () => undefined)` —— 事务里什么都没做，
    // 随后的目标读取走事务外 `db`、RT 撤销又用事务外的 `db` 执行，
    // 于是"快照与写入同事务"被打破；且目标不存在时 `targets` 返回空数组使守卫静默放行。
    // 改用 `withScopedRow`，并把 `tx` 显式传给 `revokeAllRefreshTokens`。
    const jti = await withScopedRow(
      {
        operatorId: adminUserId,
        load: (tx) =>
          tx.query.users.findFirst({
            where: eq(schema.users.id, id),
            columns: { id: true, deptId: true },
          }),
        deptOf: (row) => row.deptId,
        message: '无权操作该用户',
        notFound: () => new EntityNotFoundError('用户', id),
      },
      async (tx, target) => {
        // 1. 撤销全部 Refresh Token（在同一事务内，失败即抛 → 整体回滚）
        //    并同步撤销全部 Access Token JTI。
        //    返回值只描述 **jti 层**——它永不抛出，"没撤成"必须经它回报，否则响应里的
        //    数字既可能是"无 AT 可撤"也可能是"一个都没撤成"。
        return revokeAllRefreshTokens(tx, target.id);
      },
    );

    // 2. 清除权限缓存，确保下次请求拉取最新权限
    await clearUserPermissionCache(id);

    // 3. 失效页面缓存与数据缓存（确保用户列表即时反映下线状态）
    //    Route Handler 必须用 route 版入口：`invalidateResource` 走 `updateTag`，
    //    而该原语在 route 上下文必抛（Next.js E872）——抛出点在撤销已提交之后，
    //    会造成"写成功、失效未发生、响应 5xx"并诱使调用方重试。
    invalidateResourceFromRoute('users');

    return restSuccess({
      userId: id,
      revokedJtiCount: jti.revoked,
      // jti 层永不抛出，"没撤成"只能经返回值回报：不报的话，revokedJtiCount 的 0
      // 既可能是"该用户没有活着的 AT"，也可能是"Redis 不可用、一个都没撤成"。
      jtiRevocationFailed: jti.failed,
      message: jti.failed
        ? `已强制下线用户 ${id}；Access Token 撤销未能执行（Redis 不可用），旧 AT 在自然过期前仍然有效`
        : `已强制下线用户 ${id}，撤销 ${jti.revoked} 个 Access Token JTI`,
    });
  });
}
