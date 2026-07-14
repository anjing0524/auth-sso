'use server';

/**
 * 权限管理 Server Actions (BFF 薄 Controller)
 */
import { revalidatePath, updateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
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
import { generateUUID } from '@/lib/crypto';
import { refreshUsersPermissionCache } from '@/lib/permissions';
import { revokeUsersAccessByUserId } from '@/lib/session/revoke';
import { COMMON_ERRORS, type ApiResponse } from '@auth-sso/contracts';

async function getAffectedUserIds(permId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
    .where(eq(schema.rolePermissions.permissionId, permId));
  return [...new Set(rows.map((r) => r.userId))];
}

async function invalidateAffectedUsersCache(permId: string): Promise<void> {
  const userIds = await getAffectedUserIds(permId);
  if (userIds.length > 0) {
    await refreshUsersPermissionCache(userIds);
    await revokeUsersAccessByUserId(userIds);
  }
}

/** 创建权限 */
export const createPermissionAction = withAuth(
  { permissions: ['permission:create'], audit: 'PERMISSION_CREATE' },
  async (_ctx: AuthContext, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const parsed = CreatePermissionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message };
    }

    // 查重 + 插入在事务中原子完成，避免 race condition
    const perm = await db.transaction(async (tx) => {
      const existing = await tx.select({ id: schema.permissions.id })
        .from(schema.permissions)
        .where(eq(schema.permissions.code, parsed.data.code))
        .limit(1);
      if (existing[0]) throw new DuplicateEntityError('Permission', 'code');

      const p = createPermission(parsed.data, generateUUID);
      await tx.insert(schema.permissions).values(permissionToInsertRow(p));
      return p;
    });

    revalidatePath('/permissions');
    updateTag('permissions-list');
    return { success: true, data: { id: perm.id }, message: '权限创建成功' };
  },
);

/** 更新权限 */
export const updatePermissionAction = withAuth(
  { permissions: ['permission:update'], audit: 'PERMISSION_UPDATE' },
  async (_ctx: AuthContext, permId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdatePermissionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message };
    }

    const updated = await db.transaction(async (tx) => {
      const row = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.id, permId),
      });
      if (!row) throw new EntityNotFoundError('Permission', permId);

      const perm = toDomainPermission(row);
      const updated = applyPermissionUpdate(perm, parsed.data);

      await tx.update(schema.permissions).set(permissionToUpdateRow(updated))
        .where(eq(schema.permissions.id, perm.id));
      return updated;
    });

    // 权限变更影响所有绑定了该权限的角色 → 这些角色的用户权限缓存需刷新
    await invalidateAffectedUsersCache(permId);

    revalidatePath('/permissions');
    updateTag('permissions-list');
    return { success: true, data: { id: permId }, message: '权限更新成功' };
  },
);

/** 删除权限 */
export const deletePermissionAction = withAuth(
  { permissions: ['permission:delete'], audit: 'PERMISSION_DELETE' },
  async (_ctx: AuthContext, permId: string): Promise<ApiResponse<{ id: string }>> => {
    const row = await db.query.permissions.findFirst({
      where: eq(schema.permissions.id, permId),
    });
    if (!row) throw new EntityNotFoundError('Permission', permId);

    // 事务前获取受影响的用户 ID（事务中 rolePermissions 会被删除）
    const affectedUserIds = await getAffectedUserIds(permId);

    await db.transaction(async (tx) => {
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.permissionId, row.id));
      await tx.delete(schema.permissions).where(eq(schema.permissions.id, row.id));
    });

    if (affectedUserIds.length > 0) {
      await refreshUsersPermissionCache(affectedUserIds);
      await revokeUsersAccessByUserId(affectedUserIds);
    }

    revalidatePath('/permissions');
    updateTag('permissions-list');
    return { success: true, data: { id: permId }, message: '权限已删除' };
  },
);
