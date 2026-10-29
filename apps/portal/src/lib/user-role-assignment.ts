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
 * - 范围快照与写入**同一事务**（ADR-014 / H-ACL-002），且目标行**只加载一次**：
 *   `withScopedRow` 的 load → 404 → 范围断言 → handler 是同一份 row，
 *   不再出现"守卫加载的行 ≠ handler 再次加载的行"的窗口（ADR-028）。
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
import { EntityNotFoundError, ForbiddenError } from '@/domain/shared/errors';
import { withScopedRow, loadOperatorAuthorization } from '@/lib/authz';
import { appendSecurityAudit } from '@/lib/audit';
import { revokeAndRefreshAuthorization } from '@/lib/auth/authorization-effects';

export const MAX_ASSIGNED_ROLES = 100;

/** 分配角色的入参（REST 路由与 Server Action 共用同一份 zod，避免第二份漂移） */
export const RoleAssignmentSchema = z
  .object({
    roleIds: z
    .array(z.string().uuid())
    .min(1, '用户至少需要保留一个角色；如需停用账号，请在用户详情使用「禁用账号」')
    .max(MAX_ASSIGNED_ROLES),
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

/** 事务句柄类型（与 `withScopedRow` 的 handler 入参一致） */
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
  operatorId: string,
): Promise<string | null> {
  if (!userDeptId) return '该用户尚未分配部门，请先为用户分配部门后再分配角色';
  const roles = await tx
    .select({
      id: schema.roles.id,
      name: schema.roles.name,
      deptId: schema.roles.deptId,
      status: schema.roles.status,
      isSystem: schema.roles.isSystem,
    })
    .from(schema.roles)
    .where(inArray(schema.roles.id, roleIds));
  if (roles.length !== roleIds.length) return '存在无效角色';
  const invalid = roles.filter((r) => r.deptId !== userDeptId || r.status !== ENTITY_ACTIVE);
  if (invalid.length > 0) return '部分角色不属于该用户所属部门或已禁用，无法分配';

  // 授权决策的授权：操作者不能分配系统角色，也不能把自己权限边界之外的能力授出。
  // 管理员（ADMIN/SUPER_ADMIN）保留平台级分配能力。
  const operator = await loadOperatorAuthorization(tx, operatorId);
  if (!operator) throw new ForbiddenError('操作者账号不可用');
  if (operator.isAdmin) return null;

  if (roles.some((role) => role.isSystem)) {
    throw new ForbiddenError('仅系统管理员可以分配系统内置角色');
  }
  const targetPermissions = await tx
    .select({ roleId: schema.rolePermissions.roleId, code: schema.permissions.code })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
    .where(
      and(
        inArray(schema.rolePermissions.roleId, roleIds),
        eq(schema.permissions.status, ENTITY_ACTIVE),
      ),
    );
  const byRole = new Map<string, Set<string>>();
  for (const row of targetPermissions) {
    const set = byRole.get(row.roleId) ?? new Set<string>();
    set.add(row.code);
    byRole.set(row.roleId, set);
  }
  const overreach = roles.find((role) => {
    const codes = byRole.get(role.id);
    return codes ? [...codes].some((code) => !operator.permissions.has(code)) : false;
  });
  if (overreach) {
    throw new ForbiddenError(`不能分配超出自身权限的角色「${overreach.name}」`);
  }
  return null;
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
  try {
    const result = await withScopedRow(
      {
        operatorId,
        load: (tx) =>
          tx.query.users.findFirst({
            where: eq(schema.users.id, targetUserId),
            columns: { id: true, deptId: true },
          }),
        deptOf: (userRow) => userRow.deptId,
        message: '无权操作该用户',
        notFound: () => new EntityNotFoundError('User', targetUserId),
      },
      async (tx, userRow) => {
        const errMsg = await validateRoleAssignment(tx, userRow.deptId, roleIds, operatorId);
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
  } catch (err) {
    // 目标不存在是业务 404（与既有的 handler 语义一致）；范围越界（ForbiddenError）继续上抛给信封映射
    if (err instanceof EntityNotFoundError) {
      return { ok: false, error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在', status: 404 };
    }
    throw err;
  }
}

/** 移除用户的指定角色（精准比对，绝不误删该用户的其他角色） */
export async function removeUserRole(
  operatorId: string,
  targetUserId: string,
  roleId: string,
  audit: RoleWriteAuditContext,
): Promise<RoleWriteResult<{ userId: string }>> {
  try {
    const result = await withScopedRow(
      {
        operatorId,
        load: (tx) =>
          tx.query.users.findFirst({
            where: eq(schema.users.id, targetUserId),
            columns: { id: true, deptId: true },
          }),
        deptOf: (userRow) => userRow.deptId,
        message: '无权操作该用户',
        notFound: () => new EntityNotFoundError('User', targetUserId),
      },
      async (tx, userRow) => {
        // 与 RoleAssignmentSchema.min(1) 对齐：服务端也必须保证用户至少保留一个角色。
        // UI 的“最后一个角色”保护不能替代 API 不变量——直接调用 DELETE 仍可能把
        // 用户锁死（可用性/权限决策变更），且会让 RoleAssignmentSchema 的约束失真。
        const bound = await tx
          .select({ roleId: schema.userRoles.roleId })
          .from(schema.userRoles)
          .where(eq(schema.userRoles.userId, userRow.id));
        if (bound.length <= 1 && bound.some((row) => row.roleId === roleId)) {
          return {
            success: false as const,
            error: COMMON_ERRORS.VALIDATION_ERROR,
            message: '用户至少需要保留一个角色；如需停用账号，请在用户详情使用「禁用账号」',
            status: 400,
          };
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
  } catch (err) {
    if (err instanceof EntityNotFoundError) {
      return { ok: false, error: COMMON_ERRORS.NOT_FOUND, message: '用户不存在', status: 404 };
    }
    throw err;
  }
}
