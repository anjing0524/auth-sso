/**
 * OAuth 授权端点的数据访问层 (Read Model)
 *
 * 封装 authorize/route.ts 所需的复杂查询（用户 → 角色 → 权限 → Client 绑定），
 * 返回干净的 DTO 结构，零 DB 形状泄漏到 Controller。
 *
 * v3.2: role_clients 表已删除，改为通过 permissions.client_id 链路查询
 */
import 'server-only';

import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';

export interface UserWithRoleClients {
  id: string;
  status: string;
  roles: Array<{
    id: string;
    code: string;
    status: string;
    /** 该角色拥有权限所关联的 client_id 列表（v3.2: 替代 roleClients 表） */
    clientIds: string[];
  }>;
}

/**
 * 获取用户及其角色+Client 绑定信息（供 OAuth 授权准入检查使用）
 *
 * 使用 db.query 关系查询，通过 permissions.client_id 链路确定角色对客户端的访问权限
 * （users → userRoles → roles → rolePermissions → permissions.client_id）。
 *
 * @param userId 用户内部 ID（来自 session JWT claims.sub）
 * @returns 用户+角色+Client 绑定结构，不存在时返回 null
 */
export async function getUserWithRoleClients(userId: string): Promise<UserWithRoleClients | null> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    with: {
      userRoles: {
        with: {
          role: {
            with: {
              rolePermissions: {
                with: {
                  permission: {
                    columns: { clientId: true, status: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    status: user.status,
    roles: user.userRoles
      .map((ur) => ur.role)
      .filter((r): r is NonNullable<typeof r> => r !== null && r.status === ENTITY_ACTIVE)
      .map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        clientIds: Array.from(
          new Set(
            r.rolePermissions
              .filter((rp) => rp.permission !== null && rp.permission.status === ENTITY_ACTIVE)
              .map((rp) => rp.permission!.clientId)
              .filter((cid): cid is string => cid !== null && cid !== undefined),
          ),
        ),
      })),
  };
}
