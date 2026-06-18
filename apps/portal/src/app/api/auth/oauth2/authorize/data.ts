/**
 * OAuth 授权端点的数据访问层 (Read Model)
 *
 * 封装 authorize/route.ts 所需的复杂查询（用户 → 角色 → Client 嵌套 JOIN），
 * 返回干净的 DTO 结构，零 DB 形状泄漏到 Controller。
 */
import 'server-only';

import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';

export interface UserWithRoleClients {
  id: string;
  status: string;
  roles: Array<{
    id: string;
    code: string;
    status: string;
    roleClients: Array<{ roleId: string; clientId: string }>;
  }>;
}

/**
 * 获取用户及其角色+Client 绑定信息（供 OAuth 授权准入检查使用）
 *
 * 使用 db.query 关系查询，单次 DB 往返完成 4 层嵌套 JOIN
 * （users → userRoles → roles → roleClients）。
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
              roleClients: true,
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
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        roleClients: r.roleClients.map((rc) => ({
          roleId: rc.roleId,
          clientId: rc.clientId,
        })),
      })),
  };
}
