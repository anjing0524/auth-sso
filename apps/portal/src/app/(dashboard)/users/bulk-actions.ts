'use server';

/**
 * 用户批量操作 — 独立 Server Action。
 *
 * 产品背景：后台用户列表需要"勾选多人 → 批量禁用/恢复"，逐个点开是高频痛点。
 * 本文件独立存在（不改 users/actions.ts），复用同一套 withAuth + withScopedRow
 * 作用域写入：每个 id 都按操作者数据范围重新加载，越界/不存在计为失败，
 * 不因个体失败而回滚已经成功的其他用户（并返回真实成功/失败计数）。
 */
import { eq } from 'drizzle-orm';
import { COMMON_ERRORS, USER_ACTIVE, USER_ERRORS, USER_PERMISSIONS, type ApiResponse } from '@auth-sso/contracts';

import { schema } from '@/infrastructure/db';
import type { DbTxHandle } from '@/infrastructure/db';
import { withAuth, type AuthContext } from '@/lib/auth';
import { withScopedRow } from '@/lib/authz';
import { invalidateResource } from '@/lib/cache-invalidation';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { validate } from '@/lib/validation';
import { UserIdentityInputSchema } from '@/domain/user/types';
import { BusinessRuleViolationError } from '@/domain/shared/errors';

const MAX_BULK = 100;
type BulkStatus = 'ACTIVE' | 'DISABLED';

function loadUserScoped(operatorId: string, userId: string) {
  return {
    operatorId,
    load: (tx: DbTxHandle) =>
      tx.query.users.findFirst({
        where: eq(schema.users.id, userId),
        columns: { id: true, deptId: true, status: true },
      }),
    deptOf: (row: { deptId: string | null }) => row.deptId,
    message: '无权操作该部门的用户',
    notFound: () => new Error(`用户 ${userId} 不存在`),
  };
}

/**
 * 批量更新用户状态。
 *
 * - 只接受白名单状态（ACTIVE / DISABLED）与 1..100 个 id；
 * - 禁止把操作者自己禁用（与单条 toggle 规则一致；启用自己允许）；
 * - 每个用户独立事务 + 作用域守卫；成功后撤销其活跃 JWT，状态即时生效。
 */
export const bulkUpdateUserStatusAction = withAuth(
  { permissions: [USER_PERMISSIONS.UPDATE], audit: 'USER_UPDATE' },
  async (ctx: AuthContext, ids: string[], status: BulkStatus): Promise<ApiResponse<{ updated: number; failed: number }>> => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: `一次最多操作 ${MAX_BULK} 个用户` };
    }
    if (status !== 'ACTIVE' && status !== 'DISABLED') {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: '非法的目标状态' };
    }
    const unique = [...new Set(ids)];
    for (const id of unique) {
      const v = validate(UserIdentityInputSchema, { id });
      if (!v.ok) return v.response;
    }
    if (status === 'DISABLED' && unique.includes(ctx.userId)) {
      throw new BusinessRuleViolationError('不能禁用自己的账号', USER_ERRORS.CANNOT_DISABLE_SELF);
    }

    let updated = 0;
    let failed = 0;
    for (const id of unique) {
      try {
        const changed = await withScopedRow(loadUserScoped(ctx.userId, id), async (tx, row) => {
          if (!row || row.status === status) return false;
          await tx.update(schema.users).set({ status }).where(eq(schema.users.id, id));
          return true;
        });
        if (changed) {
          // 状态变更即时生效：撤销该用户活跃 JWT（失败由 lib/session/revoke 记日志，不阻断）
          await revokeUserAccessByUserId(id);
          updated += 1;
        }
      } catch {
        failed += 1;
      }
    }

    invalidateResource('users');
    const targetLabel = status === USER_ACTIVE ? '恢复' : '禁用';
    return {
      success: true,
      data: { updated, failed },
      message: `已${targetLabel} ${updated} 个用户${failed > 0 ? `，${failed} 个失败（越权或不存在）` : ''}`,
    };
  },
);
