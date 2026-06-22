'use server';

/**
 * 菜单管理 Server Actions (BFF 薄 Controller)
 */
import { revalidatePath, revalidateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { byIdOrPublicId } from '@/db/resolve-id';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createMenu,
  menuToInsertRow,
  menuToUpdateRow,
  applyMenuUpdate,
  toDomainMenu,
} from '@/domain/menu/menu';
import {
  CreateMenuInputSchema,
  UpdateMenuInputSchema,
  type CreateMenuInput,
} from '@/domain/menu/types';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { generateId } from '@/lib/crypto';
import type { ApiResponse } from '@auth-sso/contracts';

/** 创建菜单 */
export const createMenuAction = withAuth(
  { permissions: ['menu:create'] },
  async (_ctx: AuthContext, input: CreateMenuInput): Promise<ApiResponse<{ id: string }>> => {
    const parsed = CreateMenuInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    const menu = createMenu(parsed.data, generateId);
    await db.insert(schema.menus).values(menuToInsertRow(menu));

    revalidatePath('/menus');
    revalidateTag('menus-list');
    return { success: true, data: { id: menu.publicId }, message: '菜单创建成功' };
  },
);

/** 更新菜单 */
export const updateMenuAction = withAuth(
  { permissions: ['menu:update'] },
  async (_ctx: AuthContext, menuId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdateMenuInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    const row = await db.query.menus.findFirst({
      where: byIdOrPublicId('menus', menuId),
    });
    if (!row) throw new EntityNotFoundError('Menu', menuId);

    const menu = toDomainMenu(row);
    const updated = applyMenuUpdate(menu, parsed.data);

    await db.update(schema.menus).set(menuToUpdateRow(updated))
      .where(eq(schema.menus.id, menu.id));

    revalidatePath('/menus');
    revalidateTag('menus-list');
    return { success: true, data: { id: menuId }, message: '菜单更新成功' };
  },
);

/** 递归删除菜单 */
async function deleteMenuRecursive(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  menuId: string,
): Promise<void> {
  const children = await tx.query.menus.findMany({
    where: eq(schema.menus.parentId, menuId),
  });
  for (const child of children) {
    await deleteMenuRecursive(tx, child.id);
  }
  await tx.delete(schema.menus).where(eq(schema.menus.id, menuId));
}

/** 删除菜单 */
export const deleteMenuAction = withAuth(
  { permissions: ['menu:delete'] },
  async (_ctx: AuthContext, menuId: string): Promise<ApiResponse<{ id: string }>> => {
    const row = await db.query.menus.findFirst({
      where: byIdOrPublicId('menus', menuId),
    });
    if (!row) throw new EntityNotFoundError('Menu', menuId);

    await db.transaction(async (tx) => {
      await deleteMenuRecursive(tx, row.id);
    });

    revalidatePath('/menus');
    revalidateTag('menus-list');
    return { success: true, data: { id: menuId }, message: '菜单及其子项已递归删除' };
  },
);
