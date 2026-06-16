'use server';

/**
 * 权限管理 Server Actions (BFF 薄 Controller)
 */
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createPermission,
  permissionToInsertRow,
  permissionToUpdateRow,
  applyPermissionUpdate,
  toDomainPermission,
} from '@/domain/permission/permission';
import {
  CreatePermissionInputSchema,
  UpdatePermissionInputSchema,
  type CreatePermissionInput,
} from '@/domain/permission/types';
import { EntityNotFoundError, DuplicateEntityError } from '@/domain/shared/errors';
import { generateId } from '@/lib/crypto';
import type { ApiResponse } from '@auth-sso/contracts';

/** 创建权限 */
export const createPermissionAction = withAuth(
  { permissions: ['permission:create'] },
  async (_ctx: AuthContext, input: CreatePermissionInput): Promise<ApiResponse<{ id: string }>> => {
    const parsed = CreatePermissionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    const existing = await db.query.permissions.findFirst({
      where: eq(schema.permissions.code, parsed.data.code),
    });
    if (existing) throw new DuplicateEntityError('Permission', 'code');

    const perm = createPermission(parsed.data, generateId);
    await db.insert(schema.permissions).values(permissionToInsertRow(perm));

    revalidatePath('/permissions');
    return { success: true, data: { id: perm.publicId }, message: '权限创建成功' };
  },
);

/** 更新权限 */
export const updatePermissionAction = withAuth(
  { permissions: ['permission:update'] },
  async (_ctx: AuthContext, permId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdatePermissionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    const row = await db.query.permissions.findFirst({
      where: or(eq(schema.permissions.id, permId), eq(schema.permissions.publicId, permId)),
    });
    if (!row) throw new EntityNotFoundError('Permission', permId);

    const perm = toDomainPermission(row);
    const updated = applyPermissionUpdate(perm, parsed.data);

    await db.update(schema.permissions).set(permissionToUpdateRow(updated))
      .where(eq(schema.permissions.id, perm.id));

    revalidatePath('/permissions');
    return { success: true, data: { id: permId }, message: '权限更新成功' };
  },
);

/** 删除权限 */
export const deletePermissionAction = withAuth(
  { permissions: ['permission:delete'] },
  async (_ctx: AuthContext, permId: string): Promise<ApiResponse<{ id: string }>> => {
    const row = await db.query.permissions.findFirst({
      where: or(eq(schema.permissions.id, permId), eq(schema.permissions.publicId, permId)),
    });
    if (!row) throw new EntityNotFoundError('Permission', permId);

    await db.transaction(async (tx) => {
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.permissionId, row.id));
      await tx.delete(schema.permissions).where(eq(schema.permissions.id, row.id));
    });

    revalidatePath('/permissions');
    return { success: true, data: { id: permId }, message: '权限已删除' };
  },
);
