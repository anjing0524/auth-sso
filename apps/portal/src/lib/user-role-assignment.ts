import 'server-only';

/**
 * 用户角色分配的**唯一写路径**（REST 路由与 Server Action 两个适配器共用）
 *
 * ## 为什么需要它
 *
 * 内部页面的角色分配原本经 `fetch POST /api/users/:id/roles` 完成——与本仓成文的
 * 「内部页面**写操作**只用 Server Actions」相悖。把它改成 Server Action 时有个陷阱：
 * 若把路由里那段编排（范围守卫 → 事务内校验 → 删旧插新 → 审计 → 权限收敛）
 * **抄第二遍**，就正好复刻了 `lib/authz` 当初要消灭的"同一件事两种形状"。
 *
 * ⇒ seam 落在这里：本模块是写路径的**唯一实现**，两个适配器只负责各自的信封与缓存失效：
 *
 * | 适配器 | 信封 | 缓存失效 |
 * |---|---|---|
 * | `api/users/[id]/roles/route.ts`（POST） | `restError` / `restSuccess` | `invalidateResourceFromRoute` |
 * | `(dashboard)/users/actions.ts`（Server Action） | `ApiError` | `invalidateResource` |
 *
 * 缓存失效**故意不放在本模块**：`cache-invalidation-site-guard` 禁止 route 用 Action 版入口、
 * 反之亦然 ⇒ 那段必须由调用方按自己的身份选择。
 *
 * ## 语义（与原路由逐条一致，勿轻改）
 *
 * - 范围快照与写入**同一事务**（ADR-014 / H-ACL-002）：原实现快照取在事务外，
 *   操作者被降权后仍会放行。
 * - 角色必须属于该用户部门且为 `ACTIVE`（R-USER-ROLE）。
 * - 分配属于**权限决策变更** ⇒ 收敛（撤销 AT 强制重登 + 刷缓存）。
 *
 * @module lib/user-role-assignment
 */
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { ErrorCode } from '@auth-sso/contracts';
import { COMMON_ERRORS, ENTITY_ACTIVE } from '@auth-sso/contracts';
import { type db, schema } from '@/infrastructure/db';
import { withScopedWrite } from '@/lib/authz';
import { appendSecurityAudit } from '@/lib/audit';
import { revokeAndRefreshAuthorization } from '@/lib/auth/authorization-effects';

export const MAX_ASSIGNED_ROLES = 100;

/** 分配角色的入参（REST 路由与 Server Action 共用同一份 zod，避免第二份漂移） */
export const RoleAssignmentSchema = z
  .object({
    roleIds: z.array(z.string().uuid()).min(1).max(MAX_ASSIGNED_ROLES),
  })
  .superRefine(({ roleIds }, ctx) => {
    if (new Set(roleIds).size !== roleIds.length) {
      ctx.addIssue({ code: 'custom', message: '角色 ID 不可重复', path: ['roleIds'] });
    }
  });

/** 移除单个角色的入参 */
export const RoleRemovalSchema = z.object({ roleId: z.string().uuid() });

/** 审计上下文由调用方提供（HTTP 面有 url/ip/UA；Server Action 面给自己一个可追溯的 url） */
export interface RoleWriteAuditContext {
  method: 'POST' | 'DELETE';
  url: string;
  ip: string | null;
  userAgent: string | null;
}

/** 写路径结果：成功带业务数据，失败带可直接进信封的码/消息/状态 */
export type RoleWriteResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: ErrorCode; message: string; status: number };

/** 事务句柄类型（与 `withScopedWrite` 的 handler 入参一致） */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 校验角色全部属于用户部门且为 `ACTIVE`（R-USER-ROLE）。
 *
 * @returns 通过返回 `null`；否则返回可直接展示的中文原因
 */
async function validateRoleAssignment(
  tx: Tx,
  userDeptId: string | null,
  roleIds: readonly string[],
): Promise<string | null> {
  if (!userDeptId) return '该用户尚未分配部门，请先为用户分配部门后再分配角色';
  const roles = await tx
    .select({ id: schema.roles.id, deptId: schema.roles.deptId, status: schema.roles.status })
    .from(schema.roles)
    .where(inArray(schema.roles.id, roleIds));
  if (roles.length !== roleIds.length) return '存在无效角色';
  const invalid = roles.filter((r) => r.deptId !== userDeptId || r.status !== ENTITY_ACTIVE);
  return invalid.length > 0 ? '部分角色不属于该用户所属部门或已禁用，无法分配' : null;
}

/** 用户是否在操作者数据范围内（不存在时返回空目标 ⇒ 由调用方按 404 处理） */
function scopedTargets(targetUserId: string) {
  return async (tx: Tx) => {
    const target = await tx.query.users.findFirst({
      where: eq(schema.users.id, targetUserId),
      columns: { deptId: true },
    });
    if (!target) return [];
    return [{ deptId: target.deptId, message: '无权操作该用户' }];
  };
}

/**
 * 为用户分配角色（覆盖式：删旧插新）。
 *
 * 成功时已**完成权限收敛**（撤销 AT + 刷权限缓存）；缓存失效由调用方按自身身份执行。
 */
export async function assignUserRoles(
  operatorId: string,
  targetUserId: string,
  roleIds: readonly string[],
  audit: RoleWriteAuditContext,
): Promise<RoleWriteResult<{ assignedCount: readonly string[] }>> {
  const result = await withScopedWrite(
    { operatorId, targets: scopedTargets(targetUserId) },
    async (tx) => {
      const userRow = await tx.query.users.findFirst({
        where: eq(schema.users.id, targetUserId),
        columns: { id: true, deptId: true },
      });
      if (!userRow) {
        return { success: false as const, error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在', status: 404 };
      }

      const errMsg = await validateRoleAssignment(tx, userRow.deptId, roleIds);
      if (errMsg) {
        return { success: false as const, error: COMMON_ERRORS.VALIDATION_ERROR, message: errMsg, status: 400 };
      }

      await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, userRow.id));
      await tx.insert(schema.userRoles).values(
        roleIds.map((roleId) => ({ userId: userRow.id, roleId, createdAt: new Date() })),
      );
      await appendSecurityAudit(tx, {
        userId: operatorId,
        operation: 'USER_ROLE_ASSIGN',
        method: audit.method,
        url: audit.url,
        params: { targetUserId: userRow.id, roleIds: [...roleIds] },
        ip: audit.ip,
        userAgent: audit.userAgent,
        status: 200,
      });
      return { success: true as const, assignedCount: roleIds };
    },
  );

  if (!result.success) {
    return { ok: false, error: result.error, message: result.message, status: result.status };
  }

  // 权限决策变更 ⇒ 收敛（撤销 AT 强制重登 + 刷权限缓存），顺序由该 module 固定
  await revokeAndRefreshAuthorization([targetUserId]);
  return { ok: true, assignedCount: result.assignedCount };
}

/** 移除用户的指定角色（精准比对，绝不误删该用户的其他角色） */
export async function removeUserRole(
  operatorId: string,
  targetUserId: string,
  roleId: string,
  audit: RoleWriteAuditContext,
): Promise<RoleWriteResult<{ userId: string }>> {
  const result = await withScopedWrite(
    { operatorId, targets: scopedTargets(targetUserId) },
    async (tx) => {
      const userRow = await tx.query.users.findFirst({
        where: eq(schema.users.id, targetUserId),
        columns: { id: true },
      });
      if (!userRow) {
        return { success: false as const, error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在', status: 404 };
      }

      await tx.delete(schema.userRoles).where(
        and(eq(schema.userRoles.userId, userRow.id), eq(schema.userRoles.roleId, roleId)),
      );
      await appendSecurityAudit(tx, {
        userId: operatorId,
        operation: 'USER_ROLE_ASSIGN',
        method: audit.method,
        url: audit.url,
        params: { targetUserId: userRow.id, roleId },
        ip: audit.ip,
        userAgent: audit.userAgent,
        status: 200,
      });
      return { success: true as const, userId: userRow.id };
    },
  );

  if (!result.success) {
    return { ok: false, error: result.error, message: result.message, status: result.status };
  }

  await revokeAndRefreshAuthorization([result.userId]);
  return { ok: true, userId: result.userId };
}
