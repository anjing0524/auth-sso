/**
 * 双 ID 查找辅助函数
 *
 * 消除 6+ 个 data.ts 文件中重复的 .where(or(eq(t.id, x), eq(t.publicId, x))) 模式。
 * 所有实体表均支持以内部 id 或 publicId 进行精确匹配查找。
 *
 * @module db/resolve-id
 */
import { eq, or, type SQL } from 'drizzle-orm';
import { schema } from '@/infrastructure/db';

/**
 * 支持双 ID 查找的表名（联合类型约束，确保障编译期穷举）
 */
export type LookupTable = 'users' | 'roles' | 'clients' | 'menus' | 'departments' | 'permissions';

const tableMap = {
  users: schema.users,
  roles: schema.roles,
  clients: schema.clients,
  menus: schema.menus,
  departments: schema.departments,
  permissions: schema.permissions,
} as const;

/**
 * 构建「按 id 或 publicId 匹配单行」的 WHERE 条件
 *
 * @param table  表名
 * @param lookup 用户输入的标识符（可能是内部 id 或 publicId）
 * @returns Drizzle SQL 条件（可与 and() 组合）
 *
 * @example
 * ```ts
 * const user = await db.query.users.findFirst({
 *   where: byIdOrPublicId('users', lookupId),
 *   with: { userRoles: { with: { role: true } } },
 * });
 * ```
 */
export function byIdOrPublicId(table: keyof typeof tableMap, lookup: string): SQL<unknown> {
  const t = tableMap[table];
  return or(eq(t.id, lookup), eq(t.publicId, lookup)) as SQL<unknown>;
}
