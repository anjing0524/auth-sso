import 'server-only';

import { eq } from 'drizzle-orm';
import type { DbTxHandle } from '@/infrastructure/db';
import { schema } from '@/infrastructure/db';
import { ENTITY_ACTIVE, isAdminRole } from '@auth-sso/contracts';

export interface OperatorAuthorization {
  /** 是否为 ADMIN / SUPER_ADMIN（角色码判定，与 checkPermission 的管理员绕过同口径） */
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
