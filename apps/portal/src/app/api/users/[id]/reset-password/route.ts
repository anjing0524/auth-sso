/**
 * 用户密码重置 API (B-USR-PW)
 *
 * POST /api/users/[id]/reset-password — 管理员重置用户密码，所有活跃会话立即失效
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, canAccessDept } from '@/lib/auth';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { hashPassword, isPasswordReused, pushPasswordHistory } from '@/domain/auth/password';
import { COMMON_ERRORS, USER_ERRORS } from '@auth-sso/contracts';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { refreshUserPermissionCache } from '@/lib/permissions';
import { validatePassword } from '@/domain/shared/zod-schemas';

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
) {
  return withPermission({ permissions: ['user:reset_password'] }, async (adminUserId, claims) => {
    const { id } = await params;
    const body = await request.json();
    const newPassword = body.password as string;

    // NFR-SEC-05: 密码策略统一校验（单一真相源 — domain/shared/zod-schemas.ts PasswordSchema）
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: passwordError },
        { status: 400 },
      );
    }

    // 数据范围守卫：只能重置本部门（含子部门）范围内用户的密码（H-DSCOPE-003）
    // 同时读取 passwordHistory 用于 NFR-SEC-15 校验
    const target = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
      columns: { id: true, deptId: true, passwordHash: true, passwordHistory: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: USER_ERRORS.USER_NOT_FOUND, message: '用户不存在' },
        { status: 404 },
      );
    }
    if (!canAccessDept(claims.deptIds, target.deptId)) {
      return NextResponse.json(
        { error: COMMON_ERRORS.FORBIDDEN, message: '无权操作该用户' },
        { status: 403 },
      );
    }

    // NFR-SEC-15: 禁止重用最近 5 次密码
    if (await isPasswordReused(newPassword, target.passwordHistory ?? null)) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '新密码不能与该用户最近使用过的密码相同' },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(newPassword);
    const newHistory = pushPasswordHistory(target.passwordHistory ?? null, target.passwordHash ?? '');

    await db.transaction(async (tx) => {
      await tx.update(schema.users)
        .set({ passwordHash, passwordHistory: newHistory })
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
