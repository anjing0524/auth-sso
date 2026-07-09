/**
 * 用户密码重置 API (B-USR-PW)
 *
 * POST /api/users/[id]/reset-password — 管理员重置用户密码，所有活跃会话立即失效
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPermission, canAccessDept } from '@/lib/auth';
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
  return withPermission({ permissions: ['user:reset_password'] }, async (adminUserId, claims) => {
    const { id } = await params;
    const body = await request.json();
    const newPassword = body.password as string;

    // NFR-SEC-05: 密码策略 — 至少 10 位，须包含大写字母、小写字母、数字、特殊字符中至少三类
    if (!newPassword || newPassword.length < 10) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '密码至少10位，须包含大小写字母、数字或特殊字符中至少三类' },
        { status: 400 },
      );
    }
    // 统计密码字符类别数（大写/小写/数字/特殊字符），至少满足 3 类
    const categories = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/];
    const matchedCategories = categories.filter((re) => re.test(newPassword)).length;
    if (matchedCategories < 3) {
      return NextResponse.json(
        { error: COMMON_ERRORS.VALIDATION_ERROR, message: '密码须包含大写字母、小写字母、数字、特殊字符中的至少三类' },
        { status: 400 },
      );
    }

    // 数据范围守卫：只能重置本部门（含子部门）范围内用户的密码（H-DSCOPE-003）
    // deptIds 来自 JWT claims，无需额外 DB 查询
    const target = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
      columns: { id: true, deptId: true },
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

    const passwordHash = await hashPassword(newPassword);

    await db.transaction(async (tx) => {
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
