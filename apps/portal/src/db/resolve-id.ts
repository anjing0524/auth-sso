import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';

/**
 * 按 ID 查找实体（v2：public_id 已移除，所有表统一使用 uuid 类型的 id 列）
 *
 * 注意：clients 表以 client_id 为 PK，不走此函数——直接 eq(schema.clients.clientId, id)。
 */
export function byIdOrPublicId(
  table: 'users' | 'roles' | 'departments' | 'permissions',
  id: string,
) {
  const tableMap = {
    users: schema.users,
    roles: schema.roles,
    departments: schema.departments,
    permissions: schema.permissions,
  } as const;
  return eq(tableMap[table].id, id);
}
