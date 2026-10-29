import 'server-only';

/**
 * 角色 ↔ 权限授予的**唯一写路径**（REST 路由与 Server Action 两个适配器共用）
 *
 * 背景（2026-10-20）：`ROLE_PERMISSION_ASSIGN` 此前只作为"预留审计操作码"存在，
 * 全仓只有读取（`getRolePermissions`）与删除时清绑定，**没有 insert 路径、没有 UI**，
 * 而 PRD FR-ROL-05 / 矩阵 C-ROL-PA 都把它列为已交付能力——属于"声明↔实现"不一致。
 * 本模块补上写路径，两个适配器只负责各自的信封与缓存失效：
 *
 * | 适配器 | 信封 | 缓存失效 |
 * |---|---|---|
 * | `api/roles/[id]/permissions/route.ts`（POST/PUT） | `restError` / `restSuccess` | `invalidateResourceFromRoute` |
 * | `(dashboard)/roles/actions.ts`（Server Action） | `ApiError` | `invalidateResource` |
 *
 * 语义：
 * - 角色必须在操作者数据范围内且为**非系统角色**（系统角色的权限由代码分支决定，
 *   绑定它没有意义且会掩盖真实授权来源）；
 * - 目标角色**只加载一次**：`withScopedRow` 的 load → 404 → 范围断言 → handler 用同一份 row，
 *   消除"守卫时的行 ≠ 写入时的行"窗口（ADR-028）；
 * - 权限必须存在且 `ACTIVE`（覆盖式：删旧插新，与 assignUserRoles 同构）；
 * - 属于**权限决策变更** ⇒ 撤销绑定用户 AT 强制重登 + 刷权限缓存。
 */
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { ErrorCode } from '@auth-sso/contracts';
import { COMMON_ERRORS, ENTITY_ACTIVE, ROLE_ERRORS } from '@auth-sso/contracts';
import { schema } from '@/infrastructure/db';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { withScopedRow, loadOperatorAuthorization } from '@/lib/authz';
import { appendSecurityAudit } from '@/lib/audit';
import { revokeAndRefreshAuthorization } from '@/lib/auth/authorization-effects';

export const MAX_ASSIGNED_PERMISSIONS = 500;

/** 授予权限的入参（REST 路由与 Server Action 共用同一份 zod） */
export const RolePermissionAssignmentSchema = z
  .object({
    permissionIds: z.array(z.string().uuid()).max(MAX_ASSIGNED_PERMISSIONS),
  })
  .superRefine(({ permissionIds }, ctx) => {
    if (new Set(permissionIds).size !== permissionIds.length) {
      ctx.addIssue({ code: 'custom', message: '权限 ID 不可重复', path: ['permissionIds'] });
    }
  });

export interface RolePermissionAuditContext {
  method: 'POST' | 'PUT';
  url: string;
  ip: string | null;
  userAgent: string | null;
}

export type RolePermissionWriteResult =
  | { ok: true; permissionIds: readonly string[]; affectedUserIds: readonly string[] }
  | { ok: false; error: ErrorCode; message: string; status: number };


/**
 * 覆盖式设置角色的权限绑定。
 *
 * 成功后已**完成权限收敛**（撤销绑定用户 AT + 刷新权限缓存）；页面缓存失效由调用方执行。
 */
export async function assignRolePermissions(
  operatorId: string,
  roleId: string,
  permissionIds: readonly string[],
  audit: RolePermissionAuditContext,
): Promise<RolePermissionWriteResult> {
  try {
    const result = await withScopedRow(
      {
        operatorId,
        load: (tx) =>
          tx.query.roles.findFirst({
            where: eq(schema.roles.id, roleId),
            columns: { id: true, deptId: true, isSystem: true },
          }),
        deptOf: (role) => role.deptId,
        message: '无权操作该角色',
        notFound: () => new EntityNotFoundError('Role', roleId),
      },
      async (tx, role) => {
        if (role.isSystem) {
          return {
            success: false as const,
            error: ROLE_ERRORS.CANNOT_MODIFY_SYSTEM_ROLE,
            message: '系统内置角色禁止修改权限绑定',
            status: 400,
          };
        }

        let found: Array<{ id: string; code: string }> = [];
        if (permissionIds.length > 0) {
          found = await tx
            .select({ id: schema.permissions.id, code: schema.permissions.code })
            .from(schema.permissions)
            .where(
              and(
                inArray(schema.permissions.id, permissionIds),
                eq(schema.permissions.status, ENTITY_ACTIVE),
              ),
            );
          if (found.length !== permissionIds.length) {
            return {
              success: false as const,
              error: COMMON_ERRORS.VALIDATION_ERROR,
              message: '存在无效或已停用的权限',
              status: 400,
            };
          }
        }

        // 授权决策的授权：非管理员不能把自身没有的权限授予任何角色（含自己所属角色）。
        const operator = await loadOperatorAuthorization(tx, operatorId);
        if (!operator) {
          return {
            success: false as const,
            error: COMMON_ERRORS.FORBIDDEN,
            message: '操作者账号不可用',
            status: 403,
          };
        }
        if (!operator.isAdmin) {
          const overreach = found.filter((permission) => !operator.permissions.has(permission.code));
          if (overreach.length > 0) {
            return {
              success: false as const,
              error: COMMON_ERRORS.FORBIDDEN,
              message: '不能授予超出自身权限范围的权限',
              status: 403,
            };
          }
        }

        // 事务内预取绑定用户（事务后用于权限收敛）
        const boundUsers = await tx
          .select({ userId: schema.userRoles.userId })
          .from(schema.userRoles)
          .where(eq(schema.userRoles.roleId, role.id));

        await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id));
        if (permissionIds.length > 0) {
          await tx.insert(schema.rolePermissions).values(
            permissionIds.map((permissionId) => ({
              roleId: role.id,
              permissionId,
              createdAt: new Date(),
            })),
          );
        }

        await appendSecurityAudit(tx, {
          userId: operatorId,
          operation: 'ROLE_PERMISSION_ASSIGN',
          method: audit.method,
          url: audit.url,
          params: { roleId: role.id, permissionIds: [...permissionIds] },
          ip: audit.ip,
          userAgent: audit.userAgent,
          status: 200,
        });

        return {
          success: true as const,
          permissionIds,
          affectedUserIds: boundUsers.map((u) => u.userId),
        };
      },
    );

    if (!result.success) {
      return { ok: false, error: result.error, message: result.message, status: result.status };
    }

    // 权限决策变更 ⇒ 收敛（撤销 AT 强制重登 + 刷权限缓存）
    await revokeAndRefreshAuthorization(result.affectedUserIds);
    return {
      ok: true,
      permissionIds: result.permissionIds,
      affectedUserIds: result.affectedUserIds,
    };
  } catch (err) {
    // 目标不存在是业务 404；范围越界（ForbiddenError）继续上抛给信封映射
    if (err instanceof EntityNotFoundError) {
      return { ok: false, error: COMMON_ERRORS.NOT_FOUND, message: '角色不存在', status: 404 };
    }
    throw err;
  }
}
