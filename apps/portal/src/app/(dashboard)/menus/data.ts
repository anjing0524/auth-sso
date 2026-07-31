import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/infrastructure/db';

export async function getMenuManagementData() {
  'use cache';
  cacheLife('minutes');
  cacheTag('menus-list');

  const [menus, apiPermissions] = await Promise.all([
    db
      .select()
      .from(schema.permissions)
      .where(inArray(schema.permissions.type, ['DIRECTORY', 'PAGE']))
      .orderBy(asc(schema.permissions.sort), asc(schema.permissions.createdAt)),
    db
      .select({
        id: schema.permissions.id,
        code: schema.permissions.code,
        name: schema.permissions.name,
      })
      .from(schema.permissions)
      .where(and(
        eq(schema.permissions.type, 'API'),
        eq(schema.permissions.status, 'ACTIVE'),
      ))
      .orderBy(asc(schema.permissions.code)),
  ]);

  return {
    menus: menus.map((menu) => ({
      id: menu.id,
      code: menu.code,
      name: menu.name,
      type: menu.type as 'DIRECTORY' | 'PAGE',
      description: menu.description,
      path: menu.path,
      icon: menu.icon,
      visible: menu.visible !== false,
      parentId: menu.parentId,
      requiredPermissionId: menu.requiredPermissionId,
      status: menu.status,
      sort: menu.sort,
    })),
    apiPermissions,
  };
}
