/**
 * 用户密码重置 API (B-USR-PW)
 *
 * POST /api/users/[id]/reset-password — 管理员重置用户密码，所有活跃会话立即失效
 */
import { type NextRequest } from 'next/server';
import { withPermission, canAccessDept, getUserRoleDeptIds } from '@/lib/auth';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { hashPassword, isPasswordReused, pushPasswordHistory } from '@/domain/auth/password';
import { COMMON_ERRORS, USER_ERRORS } from '@auth-sso/contracts';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { refreshUserPermissionCache } from '@/lib/permissions';
import { validatePassword } from '@/domain/shared/zod-schemas';
import { createLogger } from '@/lib/logger';
import { restSuccess, restError } from '@/lib/response';

const log = createLogger('ResetPassword');

interface RouteParams { params: Promise<{ id: string }>; }

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
) {
  return withPermission({ permissions: ['user:reset_password'] }, async (adminUserId) => {
    const { id } = await params;
    const body = await request.json();
    const newPassword = body.password as string;

    // NFR-SEC-05: 密码策略统一校验（单一真相源 — domain/shared/zod-schemas.ts PasswordSchema）
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, passwordError, 400);
    }

    // 数据范围守卫：只能重置本部门（含子部门）范围内用户的密码（H-DSCOPE-003）
    // 同时读取 passwordHistory 用于 NFR-SEC-15 校验
    const target = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
      columns: { id: true, deptId: true, passwordHash: true, passwordHistory: true },
    });
    if (!target) {
      return restError(USER_ERRORS.USER_NOT_FOUND, '用户不存在', 404);
    }
    const deptIds = await getUserRoleDeptIds(adminUserId);
    if (!canAccessDept(deptIds, target.deptId)) {
      return restError(COMMON_ERRORS.FORBIDDEN, '无权操作该用户', 403);
    }

    // NFR-SEC-15: 禁止重用最近 5 次密码
    if (await isPasswordReused(newPassword, target.passwordHistory ?? null)) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, '新密码不能与该用户最近使用过的密码相同', 400);
    }

    const passwordHash = await hashPassword(newPassword);
    const newHistory = pushPasswordHistory(target.passwordHistory ?? null, target.passwordHash ?? '');

    await db.transaction(async (tx) => {
      await tx.update(schema.users)
        .set({ passwordHash, passwordHistory: newHistory })
        .where(eq(schema.users.id, id));
    });

    // 重置后所有会话立即失效（关键安全操作，必须 await 确保执行）
    try {
      await revokeUserAccessByUserId(id);
    } catch (e) {
      log.error('撤销 JWT 失败', { error: (e as Error).message });
    }
    try {
      await refreshUserPermissionCache(id);
    } catch (e) {
      log.error('刷新缓存失败', { error: (e as Error).message });
    }

    return restSuccess({ message: '密码已重置，该用户所有会话已失效' });
  });
}
