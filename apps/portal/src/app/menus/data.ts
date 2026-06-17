/**
 * 菜单管理读模型 (Read Model)
 */
import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { asc, eq, or } from 'drizzle-orm';
import { buildMenuTree, toDomainMenu } from '@/domain/menu/menu';
import type { MenuTreeNode } from '@/domain/menu/menu';

/**
 * 获取全量菜单列表（以树形结构返回）
 */
export async function getMenus(): Promise<MenuTreeNode[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('menus-list');

  const rows = await db.select()
    .from(schema.menus)
    .orderBy(asc(schema.menus.sort));

  // 复用领域适配器 toDomainMenu，消除读路径与领域层重复的字段映射
  return buildMenuTree(rows.map(toDomainMenu));
}

/**
 * 按 ID 获取单个菜单详情（支持内部 ID 和 publicId）
 */
export async function getMenuById(lookupId: string) {
  const rows = await db.select().from(schema.menus)
    .where(or(eq(schema.menus.id, lookupId), eq(schema.menus.publicId, lookupId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return toDomainMenu(row);
}
