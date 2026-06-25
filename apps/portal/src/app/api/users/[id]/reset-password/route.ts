/**
 * 用户密码重置 API (B-USR-PW)
 *
 * POST /api/users/[id]/reset-password — 管理员重置用户密码，所有活跃会话立即失效
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/domain/auth/password';
import { COMMON_ERRORS, USER_ERRORS } from '@auth-sso/contracts';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { refreshUserPermissionCache } from '@/lib/permissions';

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
) {
  return withPermission({ permissions: ['user:update'] }, async () => {
    const { id } = await params;
    const body = await request.json();
    const newPassword = body.password as string;

    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '密码至少8位，须包含大小写字母和数字' },
        { status: 400 },
      );
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '密码须包含大小写字母和数字' },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(newPassword);

    await db.transaction(async (tx) => {
      const row = await tx.query.users.findFirst({ where: eq(schema.users.id, id) });
      if (!row) throw Object.assign(new Error('用户不存在'), { code: USER_ERRORS.USER_NOT_FOUND });

      await tx.update(schema.users)
        .set({ passwordHash })
        .where(eq(schema.users.id, id));
    });

    // 重置后所有会话立即失效
    revokeUserAccessByUserId(id).catch((e) =>
      console.error('[ResetPassword] 撤销 JWT 失败:', e),
    );
    refreshUserPermissionCache(id).catch((e) =>
      console.error('[ResetPassword] 刷新缓存失败:', e),
    );

    return NextResponse.json({ success: true, message: '密码已重置，该用户所有会话已失效' });
  });
}
