/**
 * 管理员强制下线（共享实现）。
 *
 * Route Handler 与 Server Action 共用：按数据范围加载目标，
 * 在同一事务内撤销全部 Refresh Token 及对应 Access Token JTI。
 */
import 'server-only';

import { eq } from 'drizzle-orm';

import { schema } from '@/infrastructure/db';
import { withScopedRow, assertCanMutateAdminTarget } from '@/lib/authz';
import { revokeAllRefreshTokens } from '@/lib/auth/token';
import { EntityNotFoundError } from '@/domain/shared/errors';

export interface ForceLogoutResult {
  /** 成功加入 JTI 黑名单的 Access Token 数 */
  revokedJtiCount: number;
  /** Redis 不可用导致 JTI 未撤销 */
  jtiRevocationFailed: boolean;
}

/**
 * 强制下线指定用户。
 *
 * @param operatorId 操作者 ID（数据范围来源）
 * @param targetUserId 目标用户 ID
 */
export async function forceLogoutUser(
  operatorId: string,
  targetUserId: string,
): Promise<ForceLogoutResult> {
  const jti = await withScopedRow(
    {
      operatorId,
      load: (tx) =>
        tx.query.users.findFirst({
          where: eq(schema.users.id, targetUserId),
          columns: { id: true, deptId: true },
        }),
      deptOf: (row) => row.deptId,
      message: '无权操作该用户',
      notFound: () => new EntityNotFoundError('用户', targetUserId),
    },
    async (tx, target) => {
      await assertCanMutateAdminTarget(tx, operatorId, target.id);
      return revokeAllRefreshTokens(tx, target.id);
    },
  );

  return { revokedJtiCount: jti.revoked, jtiRevocationFailed: jti.failed };
}
