/**
 * 权限管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { sql } from 'drizzle-orm';
import { db, schema } from '@/infrastructure/db';
import { and, asc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { asEntityStatus, asPermissionType } from '@/lib/type-guards';
import { logServerDataRead } from '@/lib/auth';
import { withPagination, countRows, offsetFor, normalizePagination, type PaginationMeta } from '@/lib/pagination';

/**
 * 获取权限列表（可按类型过滤）
 */
type PermissionListItem = {
  id: string;
  name: string;
  code: string;
  type: string;
  path: string | null;
  icon: string | null;
  visible: boolean | null;
  clientId: string | null;
  parentId: string | null;
  status: string;
  sort: number;
  createdAt: string;
};

function toPermissionListItem(p: typeof schema.permissions.$inferSelect): PermissionListItem {
  return {
    id: p.id, name: p.name, code: p.code,
    type: p.type, path: p.path, icon: p.icon, visible: p.visible,
    clientId: p.clientId,
    parentId: p.parentId, status: p.status, sort: p.sort,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * 列表过滤条件：类型 + 关键词（名称/编码模糊匹配）。
 *
 * 2026-10-21：权限列表改为**服务端查询**（此前把全量 45+ 行一次性传给客户端，
 * 在浏览器里做过滤与分页——与 users/roles/audit 的服务端分页不一致，且数据量随权限增长线性下发）。
 */
function buildPermissionConditions(type?: string, keyword?: string, status?: string) {
  const conditions: SQL[] = [];
  if (type) conditions.push(eq(schema.permissions.type, asPermissionType(type)));
  if (status) conditions.push(eq(schema.permissions.status, asEntityStatus(status)));
  const kw = keyword?.trim();
  if (kw) {
    conditions.push(or(
      ilike(schema.permissions.name, `%${kw}%`),
      ilike(schema.permissions.code, `%${kw}%`),
    )!);
  }
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

export async function getPermissions(type?: string): Promise<PermissionListItem[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('permissions-list');

  const rows = await db.select()
    .from(schema.permissions)
    .where(buildPermissionConditions(type))
    .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt));

  return rows.map(toPermissionListItem);
}

export async function getPermissionPage({ type, keyword, status, page: rawPage, pageSize: rawPageSize }:
  { type?: string; keyword?: string; status?: string; page: number; pageSize: number }
): Promise<{ data: PermissionListItem[]; pagination: PaginationMeta }> {
  'use cache';
  cacheLife('hours');
  cacheTag('permissions-list');

  const { page, pageSize } = normalizePagination(rawPage, rawPageSize);

  const conditions = buildPermissionConditions(type, keyword, status);

  return withPagination(
    page,
    pageSize,
    db.select().from(schema.permissions).where(conditions)
      .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt))
      .limit(pageSize).offset(offsetFor(page, pageSize)),
    countRows(schema.permissions, conditions),
    toPermissionListItem,
  );
}

export interface PermissionDeletionImpact {
  /** 会被级联删除的后代节点数（不含自身） */
  descendants: number;
  /** 绑定到自身或后代权限的角色数 */
  roles: number;
  /** 通过这些角色间接受影响的用户数（去重） */
  users: number;
}

/**
 * 删除权限的影响面（递归子树 → 角色/用户计数）。
 *
 * 权限删除是级联的（`permissions.parent_id` FK ON DELETE CASCADE + role_permissions），
 * 确认弹窗需要告诉管理员“会波及多少角色/用户”，否则只能看到一句泛泛的“绑定会清除”。
 * 不缓存：删除确认必须是当前数据，且只在用户打开弹窗时调用。
 */
export async function getPermissionDeletionImpact(
  permissionId: string,
): Promise<PermissionDeletionImpact | null> {
  const exists = await db
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(eq(schema.permissions.id, permissionId))
    .limit(1);
  if (exists.length === 0) return null;

  const rows = await db.execute<{
    descendants: string | number;
    roles: string | number;
    users: string | number;
  }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM permissions WHERE id = ${permissionId}
      UNION ALL
      SELECT p.id FROM permissions p JOIN subtree s ON p.parent_id = s.id
    )
    SELECT
      (SELECT count(*) FROM subtree) - 1 AS descendants,
      (SELECT count(DISTINCT rp.role_id) FROM role_permissions rp JOIN subtree s ON rp.permission_id = s.id) AS roles,
      (SELECT count(DISTINCT ur.user_id)
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN subtree s ON rp.permission_id = s.id
         JOIN users u ON u.id = ur.user_id
        WHERE u.deleted_at IS NULL) AS users
  `);

  const row = (rows as unknown as Array<Record<string, string | number>>)[0] ?? {};
  return {
    descendants: Number(row.descendants ?? 0),
    roles: Number(row.roles ?? 0),
    users: Number(row.users ?? 0),
  };
}

/**
 * 按 ID 获取单个权限详情（内部 UUID）
 */
export async function getPermissionById(lookupId: string) {
  const rows = await db.select().from(schema.permissions)
    .where(eq(schema.permissions.id, lookupId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  await logServerDataRead('permission', lookupId);

  return {
    id: row.id, name: row.name, code: row.code,
    type: row.type, path: row.path, icon: row.icon, visible: row.visible,
    clientId: row.clientId,
    parentId: row.parentId, status: row.status, sort: row.sort,
    createdAt: row.createdAt.toISOString(),
  };
}

/** API 权限可绑定的应用选项（归属应用；与 clients-list 共用缓存失效标签） */
export async function getClientOptions(): Promise<Array<{ id: string; name: string }>> {
  'use cache';
  cacheLife('minutes');
  cacheTag('clients-list');

  return await db
    .select({ id: schema.clients.clientId, name: schema.clients.name })
    .from(schema.clients)
    .orderBy(asc(schema.clients.name));
}
