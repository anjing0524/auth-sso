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
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { byIdOrPublicId } from '@/db/resolve-id';
import { withPermission } from '@/lib/auth';
import { revokeAllRefreshTokens } from '@/lib/auth/token';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { clearUserPermissionCache } from '@/lib/permissions';
import { COMMON_ERRORS } from '@auth-sso/contracts';

export const runtime = 'nodejs';

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
  return withPermission({ permissions: ['user:manage'] }, async () => {
    const { id } = await params;

    // 兼容 publicId 和内部 id 查找用户
    const users = await db
      .select()
      .from(schema.users)
      .where(byIdOrPublicId('users', id));

    if (users.length === 0) {
      return NextResponse.json(
        { error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在' },
        { status: 404 },
      );
    }

    const userId = users[0]!.id;

    // 1. 撤销全部 Refresh Token（DB 层，同时触发 JTI 黑名单撤销）
    await revokeAllRefreshTokens(userId);

    // 2. 二次确保 Access Token JTI 全部撤销（同步等待结果，不 fire-and-forget）
    const revokedJtiCount = await revokeUserAccessByUserId(userId);

    // 3. 清除权限缓存，确保下次请求拉取最新权限
    await clearUserPermissionCache(userId);

    return NextResponse.json({
      success: true,
      userId: id,
      revokedJtiCount,
      message: `已强制下线用户 ${id}，撤销 ${revokedJtiCount} 个 Access Token JTI`,
    });
  });
}
