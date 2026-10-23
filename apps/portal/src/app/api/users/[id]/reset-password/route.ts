/**
 * 用户密码重置 API (B-USR-PW)
 *
 * POST /api/users/[id]/reset-password — 管理员重置用户密码，所有活跃会话立即失效
 *
 * 数据范围守卫经 `withScopedRow`（ADR-014）：目标行加载、范围断言、
 * 密码复用校验与密码写入**在同一事务内**，消除"快照后、提交前操作者被降权"
 * 的 TOCTOU 窗口（H-ACL-002）；目标不存在时由 DomainError 统一映射为 404。
 */
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { withScopedRow } from '@/lib/authz';
import { schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { hashPassword, isPasswordReused } from '@/domain/auth/password';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { nextPasswordHistory } from '@/domain/auth/password-change';
import { COMMON_ERRORS, USER_PERMISSIONS } from '@auth-sso/contracts';
import {
  revokeAccessTokensAfterReset,
  revokeRefreshTokensForReset,
} from '@/lib/account/reset-password';
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
    // H-31：malformed JSON / 非 JSON Content-Type 属客户端错误，必须 400 而不是落 500。
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, '请求体必须是合法的 JSON', 400);
    }
    const rawPassword = (body as { password?: unknown } | null)?.password;
    if (typeof rawPassword !== 'string' || rawPassword.length === 0) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, '新密码不能为空', 400);
    }
    const newPassword = rawPassword;

    // NFR-SEC-05: 密码策略统一校验（单一真相源 — domain/shared/zod-schemas.ts PasswordSchema）
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return restError(COMMON_ERRORS.VALIDATION_ERROR, passwordError, 400);
    }

    // bcrypt 在事务外完成（50-200ms），避免长时间占用 DB 连接
    const passwordHash = await hashPassword(newPassword);

    // 数据范围守卫 + 目标读取 + 复用校验 + 写入，**全部在同一事务内**（ADR-014 / H-ACL-002）。
    //
    // 2026-10-13 修订（架构评审 R2 候选 R11）：此前守卫写成
    // `withScopedWrite({...}, async () => undefined)` —— 事务里什么都没做，
    // 随后的 passwordHistory 读取走事务外的 `db`、写入又是**另一个**事务，
    // 于是"快照与写入同事务"这个不变量被打破（操作者在这中间被降权仍会写入）；
    // 且目标不存在时 `targets` 返回空数组使守卫静默放行。文件头注释当时却在宣称
    // 不变量成立。改用 `withScopedRow`：load → 404 → 范围断言 → handler 共用同一事务。
    const response = await withScopedRow(
      {
        operatorId: adminUserId,
        load: (tx) =>
          tx.query.users.findFirst({
            where: eq(schema.users.id, id),
            columns: { id: true, deptId: true, passwordHash: true, passwordHistory: true },
          }),
        deptOf: (row) => row.deptId,
        message: '无权操作该用户',
        notFound: () => new EntityNotFoundError('用户', id),
      },
      async (tx, target) => {
        // NFR-SEC-15: 禁止重用最近 5 次密码（H-C-06：比较集合含**当前密码**——
        // history 只在改密时推入旧 hash，不含正在使用的密码，漏掉会允许"重置为原密码"）。
        // bcrypt 比对（最多 6 次）也在事务内——这正是原先最长的敞口窗口。
        const reuseCandidates = [
          ...(target.passwordHash ? [target.passwordHash] : []),
          ...(target.passwordHistory ?? []),
        ];
        if (await isPasswordReused(newPassword, reuseCandidates)) {
          return restError(COMMON_ERRORS.VALIDATION_ERROR, '新密码不能与该用户最近使用过的密码相同', 400);
        }

        // 无旧哈希（账号首次设密码）时历史原样保留；**不得**用 `?? ''` 把空串当旧哈希写进历史
        const newHistory = nextPasswordHistory({
          currentHash: target.passwordHash,
          history: target.passwordHistory,
        });

        await tx.update(schema.users)
          .set({ passwordHash, passwordHistory: newHistory })
          .where(eq(schema.users.id, target.id));

        // H-13：RT 撤销与密码写入**同一事务**（fail-close）。此前撤销在事务外且
        // 失败被 catch 吞掉、响应仍成功——"重置密码已让所有会话失效"的承诺可能为假。
        // 现在撤销失败 → 事务回滚（密码也不写）→ withPermission 映射为失败响应。
        await revokeRefreshTokensForReset(tx, target.id);

        return restSuccess({ message: '密码已重置，该用户所有会话已失效' });
      },
    );

    // jti 层（尽力而为，ADR-011）：失败不阻断（AT ≤1h 自然过期兜底），由
    // lib/session/revoke 记日志（含 userId），故此处不写 catch——那个 catch 不可达。
    await revokeAccessTokensAfterReset(id);
    try {
      await refreshUserPermissionCache(id);
    } catch (e) {
      log.error('刷新缓存失败', { error: (e as Error).message });
    }

    // 响应体由事务内的 handler 产出（复用校验分支会返回 400）
    return response;
  });
}