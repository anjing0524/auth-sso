'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/infrastructure/db';
import { withAuth, type AuthContext } from '@/lib/auth';
import { generateUUID } from '@/lib/crypto';
import {
  validateMenuParent,
  validateMenuPath,
} from '@/domain/permission/permission';
import {
  BusinessRuleViolationError,
  DuplicateEntityError,
  EntityNotFoundError,
} from '@/domain/shared/errors';
import {
  ENTITY_ACTIVE,
  MENU_ICON_VALUES,
  PORTAL_MENU_PERMISSIONS,
  type ApiResponse,
} from '@auth-sso/contracts';
import { validate } from '@/lib/validation';
import { appendSecurityAudit, getActionAuditContext } from '@/lib/audit';

const MenuInputSchema = z.object({
  code: z.string().min(1).max(150),
  name: z.string().min(1).max(100),
  type: z.enum(['DIRECTORY', 'PAGE']),
  description: z.string().max(500).nullable().optional(),
  path: z.string().max(200).nullable(),
  icon: z.enum(MENU_ICON_VALUES).nullable(),
  visible: z.boolean(),
  parentId: z.string().uuid().nullable(),
  requiredPermissionId: z.string().uuid().nullable(),
  sort: z.number().int().min(-32768).max(32767),
});

const MenuUpdateSchema = MenuInputSchema.omit({ code: true });

async function validateReferences(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: z.infer<typeof MenuUpdateSchema>,
  menuId: string | null,
): Promise<void> {
  validateMenuPath(input.type, input.path);
  const menus = await tx
    .select({
      id: schema.permissions.id,
      parentId: schema.permissions.parentId,
      type: schema.permissions.type,
    })
    .from(schema.permissions)
    .where(inArray(schema.permissions.type, ['DIRECTORY', 'PAGE']));
  validateMenuParent(menuId, input.parentId, menus);

  if (input.parentId) {
    const parent = menus.find((menu) => menu.id === input.parentId);
    if (!parent || parent.type !== 'DIRECTORY') {
      throw new BusinessRuleViolationError('父级必须是有效的目录菜单');
    }
  }
  if (input.requiredPermissionId) {
    const requiredPermission = await tx.query.permissions.findFirst({
      where: and(
        eq(schema.permissions.id, input.requiredPermissionId),
        eq(schema.permissions.type, 'API'),
        eq(schema.permissions.status, ENTITY_ACTIVE),
      ),
      columns: { id: true },
    });
    if (!requiredPermission) {
      throw new BusinessRuleViolationError('绑定权限必须是启用的 API 权限');
    }
  }
}

function revalidateMenus() {
  revalidatePath('/menus');
  revalidatePath('/dashboard');
  updateTag('menus-list');
  updateTag('permissions-list');
}

export const createMenuAction = withAuth(
  { permissions: [PORTAL_MENU_PERMISSIONS.CREATE] },
  async (ctx: AuthContext, input: unknown): Promise<ApiResponse<{ id: string }>> => {
    const parsed = validate(MenuInputSchema, input);
    if (!parsed.ok) return parsed.response;

    const auditContext = await getActionAuditContext();
    const id = await db.transaction(async (tx) => {
      const duplicate = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.code, parsed.data.code),
        columns: { id: true },
      });
      if (duplicate) throw new DuplicateEntityError('Menu', 'code');
      await validateReferences(tx, parsed.data, null);
      const menuId = generateUUID();
      await tx.insert(schema.permissions).values({
        id: menuId,
        ...parsed.data,
        clientId: null,
        status: ENTITY_ACTIVE,
      });
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'PERMISSION_CREATE',
        targetType: 'menu',
        targetId: menuId,
        targetName: parsed.data.name,
        changes: {
          path: { after: parsed.data.path },
          parentId: { after: parsed.data.parentId },
          requiredPermissionId: { after: parsed.data.requiredPermissionId },
        },
        ...auditContext,
      });
      return menuId;
    });

    revalidateMenus();
    return { success: true, data: { id }, message: '菜单创建成功' };
  },
);

export const updateMenuAction = withAuth(
  { permissions: [PORTAL_MENU_PERMISSIONS.UPDATE] },
  async (ctx: AuthContext, menuId: string, input: unknown): Promise<ApiResponse<{ id: string }>> => {
    const parsed = validate(MenuUpdateSchema, input);
    if (!parsed.ok) return parsed.response;

    const auditContext = await getActionAuditContext();
    await db.transaction(async (tx) => {
      const menu = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.id, menuId),
      });
      if (!menu || (menu.type !== 'DIRECTORY' && menu.type !== 'PAGE')) {
        throw new EntityNotFoundError('Menu', menuId);
      }
      await validateReferences(tx, parsed.data, menuId);
      await tx.update(schema.permissions)
        .set({ ...parsed.data, clientId: null })
        .where(eq(schema.permissions.id, menuId));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'PERMISSION_UPDATE',
        targetType: 'menu',
        targetId: menuId,
        targetName: parsed.data.name,
        changes: {
          name: { before: menu.name, after: parsed.data.name },
          path: { before: menu.path, after: parsed.data.path },
          parentId: { before: menu.parentId, after: parsed.data.parentId },
          requiredPermissionId: { before: menu.requiredPermissionId, after: parsed.data.requiredPermissionId },
          visible: { before: menu.visible, after: parsed.data.visible },
        },
        ...auditContext,
      });
    });

    revalidateMenus();
    return { success: true, data: { id: menuId }, message: '菜单更新成功' };
  },
);

export const deleteMenuAction = withAuth(
  { permissions: [PORTAL_MENU_PERMISSIONS.DELETE] },
  async (ctx: AuthContext, menuId: string): Promise<ApiResponse<{ id: string }>> => {
    const auditContext = await getActionAuditContext();
    await db.transaction(async (tx) => {
      const menu = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.id, menuId),
      });
      if (!menu || (menu.type !== 'DIRECTORY' && menu.type !== 'PAGE')) {
        throw new EntityNotFoundError('Menu', menuId);
      }
      const child = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.parentId, menuId),
        columns: { id: true },
      });
      if (child) throw new BusinessRuleViolationError('请先移动或删除子菜单');
      await tx.delete(schema.permissions).where(eq(schema.permissions.id, menuId));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'PERMISSION_DELETE',
        targetType: 'menu',
        targetId: menuId,
        targetName: menu.name,
        ...auditContext,
      });
    });

    revalidateMenus();
    return { success: true, data: { id: menuId }, message: '菜单已删除' };
  },
);
