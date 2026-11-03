import 'server-only';

import { and, eq } from 'drizzle-orm';
import type { DbTxHandle } from '@/infrastructure/db';
import { schema } from '@/infrastructure/db';
import { ENTITY_ACTIVE, isAdminRole } from '@auth-sso/contracts';
import { ForbiddenError } from '@/domain/shared/errors';

export interface OperatorAuthorization {
  /** 是否为唯一 break-glass 角色 SUPER_ADMIN（与 checkPermission 同口径） */
  readonly isAdmin: boolean;
  /** 当前 ACTIVE 角色持有的 ACTIVE 权限码集合 */
  readonly permissions: ReadonlySet<string>;
}

/**
 * 事务内的操作者授权快照。
 *
 * 用于"授权决策的授权"：分配角色/授予权限时，不能只看操作者有没有
 * assign 权限，还要确认他不会把自己的权限边界之外的能力授出去。
 * 必须在写事务内调用（与目标加载/写入同一连接），避免快照漂移。
 */
export async function loadOperatorAuthorization(
  tx: DbTxHandle,
  operatorId: string,
): Promise<OperatorAuthorization | null> {
  const operator = await tx.query.users.findFirst({
    where: eq(schema.users.id, operatorId),
    columns: { id: true, status: true },
    with: {
      userRoles: {
        with: {
          role: {
            columns: { code: true, status: true },
            with: {
              rolePermissions: {
                with: {
                  permission: { columns: { code: true, status: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!operator || operator.status !== ENTITY_ACTIVE) return null;

  const roles = operator.userRoles
    .map((ur) => ur.role)
    .filter((role): role is NonNullable<typeof role> => role !== null && role.status === ENTITY_ACTIVE);
  const permissions = new Set<string>();
  for (const role of roles) {
    for (const rp of role.rolePermissions) {
      if (rp.permission?.status === ENTITY_ACTIVE) permissions.add(rp.permission.code);
    }
  }
  return {
    isAdmin: isAdminRole(roles.map((role) => role.code)),
    permissions,
  };
}

/**
 * 目标用户当前是否持有 SUPER_ADMIN break-glass 角色。
 *
 * 用于“系统管理员账号只能由管理员操作”：非管理员即使有 reset_password /
 * user:update / assign_role 等权限，也不能重置管理员密码、停用/删除管理员或
 * 修改其角色，否则这些单权限会等价于接管管理员账号。
 */
export async function targetHasAdminRole(
  tx: DbTxHandle,
  targetUserId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ code: schema.roles.code })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(and(
      eq(schema.userRoles.userId, targetUserId),
      eq(schema.roles.status, ENTITY_ACTIVE),
    ));
  return isAdminRole(rows.map((row) => row.code));
}

/** 目标用户当前持有的 ACTIVE 权限码集合（不按目标账号状态过滤，保护禁用中的管理员也生效） */
async function loadTargetPermissionCodes(
  tx: DbTxHandle,
  targetUserId: string,
): Promise<ReadonlySet<string>> {
  const rows = await tx
    .select({ code: schema.permissions.code })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
    .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
    .where(and(
      eq(schema.userRoles.userId, targetUserId),
      eq(schema.roles.status, ENTITY_ACTIVE),
      eq(schema.permissions.status, ENTITY_ACTIVE),
    ));
  return new Set(rows.map((row) => row.code));
}

/**
 * 破坏性/凭证类用户操作的统一前置守卫。
 *
 * 非管理员不得操作：
 * - 持 SUPER_ADMIN 的 break-glass 管理员；
 * - 权限码集合超出自身权限的用户（自定义高权角色同样不能被低权操作者重置密码/降权/删除）。
 *
 * 必须在与写入相同的事务内调用。
 */
export async function assertCanMutateAdminTarget(
  tx: DbTxHandle,
  operatorId: string,
  targetUserId: string,
): Promise<void> {
  const operator = await loadOperatorAuthorization(tx, operatorId);
  if (!operator) throw new ForbiddenError('操作者账号不可用');

  const [targetIsAdmin, targetPermissions] = await Promise.all([
    targetHasAdminRole(tx, targetUserId),
    loadTargetPermissionCodes(tx, targetUserId),
  ]);
  if (operator.isAdmin) return;
  if (targetIsAdmin) {
    throw new ForbiddenError('系统管理员账号只能由管理员操作');
  }
  if ([...targetPermissions].some((code) => !operator.permissions.has(code))) {
    throw new ForbiddenError('不能操作权限高于自身的用户');
  }
}

/** 目标角色当前持有的 ACTIVE 权限码集合（与目标用户权限保护同口径） */
async function loadRolePermissionCodes(
  tx: DbTxHandle,
  roleId: string,
): Promise<ReadonlySet<string>> {
  const rows = await tx
    .select({ code: schema.permissions.code })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
    .where(and(
      eq(schema.rolePermissions.roleId, roleId),
      eq(schema.permissions.status, ENTITY_ACTIVE),
    ));
  return new Set(rows.map((row) => row.code));
}

/**
 * 角色管理面的破坏性/授权变更统一前置守卫（ADR-032）。
 *
 * 与 `assertCanMutateAdminTarget` 对称：非 break-glass 操作者不得修改、删除或
 * 清空一个权限集合超出自身的角色。否则只持 role:update/delete/assign_permission
 * 的部门管理员可以破坏同部门的高权角色（停用、删除、清空权限）。
 *
 * 必须在与写入相同的事务内调用。
 */
export async function assertCanMutateRoleTarget(
  tx: DbTxHandle,
  operatorId: string,
  roleId: string,
): Promise<void> {
  const operator = await loadOperatorAuthorization(tx, operatorId);
  if (!operator) throw new ForbiddenError('操作者账号不可用');
  if (operator.isAdmin) return;

  const targetPermissions = await loadRolePermissionCodes(tx, roleId);
  if ([...targetPermissions].some((code) => !operator.permissions.has(code))) {
    throw new ForbiddenError('不能操作权限高于自身的角色');
  }
}

/** 仅 SUPER_ADMIN 可执行的全局/结构性变更（ADR-032） */
export async function assertBreakGlass(
  tx: DbTxHandle,
  operatorId: string,
  message: string,
): Promise<void> {
  const operator = await loadOperatorAuthorization(tx, operatorId);
  if (!operator) throw new ForbiddenError('操作者账号不可用');
  if (!operator.isAdmin) throw new ForbiddenError(message);
}
