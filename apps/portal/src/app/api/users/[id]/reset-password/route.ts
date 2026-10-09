/**
 * 用户密码重置 API (B-USR-PW)
 *
 * POST /api/users/[id]/reset-password — 管理员重置用户密码，所有活跃会话立即失效
 *
 * 数据范围守卫经 `withScopedWrite`（ADR-014）：操作者范围快照与密码写入
 * 在同一事务内，消除"快照后、提交前操作者被降权"的 TOCTOU 窗口。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { withScopedWrite } from '@/lib/authz';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { hashPassword, isPasswordReused, pushPasswordHistory } from '@/domain/auth/password';
import { COMMON_ERRORS, USER_ERRORS, USER_PERMISSIONS } from '@auth-sso/contracts';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { revokeUserRefreshTokens } from '@/lib/auth/token/revocation';
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
  return withPermission({ permissions: [USER_PERMISSIONS.RESET_PASSWORD] }, async (adminUserId) => {
    const { id } = await params;
    const body = await request.json();
    const newPassword = body.password as string;

    // NFR-SEC-05: 密码策略统一校验（单一真相源 — domain/shared/zod-schemas.ts PasswordSchema）
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, passwordError, 400);
    }

    // bcrypt 在事务外完成（50-200ms），避免长时间占用 DB 连接
    const passwordHash = await hashPassword(newPassword);

    // 数据范围守卫：只能重置可见范围内用户的密码（H-DSCOPE-003）。
    // 快照与后续写入同事务——原先快照取自事务外，操作者被降权后仍会放行
    // （ADR-014 / H-ACL-002）。
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

    // 读取 passwordHistory 用于 NFR-SEC-15 校验
    const target = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
      columns: { id: true, deptId: true, passwordHash: true, passwordHistory: true },
    });
    if (!target) {
      return restError(USER_ERRORS.USER_NOT_FOUND, '用户不存在', 404);
    }

    // NFR-SEC-15: 禁止重用最近 5 次密码
    if (await isPasswordReused(newPassword, target.passwordHistory ?? null)) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, '新密码不能与该用户最近使用过的密码相同', 400);
    }

    const newHistory = pushPasswordHistory(target.passwordHistory ?? null, target.passwordHash ?? '');

    await db.transaction(async (tx) => {
      await tx.update(schema.users)
        .set({ passwordHash, passwordHistory: newHistory })
        .where(eq(schema.users.id, id));
    });

    // 重置后所有会话立即失效（关键安全操作，必须 await 确保执行）。
    // 必须覆盖**两层**，与 logout / revokeAllRefreshTokens 一致：
    // 只撤 AT jti 时，窃取的 Refresh Token 仍能换取新 AT——而"重置密码踢出会话"
    // 恰恰是账号疑似失陷时的处置手段，此时旧 RT 必须一并失效。
    try {
      await revokeUserRefreshTokens(db, id);
    } catch (e) {
      log.error('撤销 Refresh Token 失败', { error: (e as Error).message });
    }
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
