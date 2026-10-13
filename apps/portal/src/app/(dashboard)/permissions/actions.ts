'use server';

/**
 * 权限管理 Server Actions (BFF 薄 Controller)
 *
 * @impl D-PRM-C — 注册新权限
 * @impl D-PRM-U — 编辑权限信息
 * @impl D-PRM-D — 删除权限
 */
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import { createPermission, applyPermissionUpdate, permissionFromPersistence, permissionToInsertRow, permissionToUpdateRow } from '@/domain/permission/permission';
import {
  CreatePermissionInputSchema,
  UpdatePermissionInputSchema,
} from '@/domain/permission/types';
import { EntityNotFoundError, DuplicateEntityError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { revokeAndRefreshAuthorization } from '@/lib/auth/authorization-effects';
import { invalidateResource } from '@/lib/cache-invalidation';
import { PERMISSION_PERMISSIONS, type ApiResponse } from '@auth-sso/contracts';

async function getAffectedUserIds(permId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
    .where(eq(schema.rolePermissions.permissionId, permId));
  return [...new Set(rows.map((r) => r.userId))];
}

/** 创建权限 */
export const createPermissionAction = withAuth(
  { permissions: [PERMISSION_PERMISSIONS.CREATE], audit: 'PERMISSION_CREATE' },
  async (_ctx: AuthContext, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(CreatePermissionInputSchema, input);
    if (!v.ok) return v.response;

    // 查重 + 插入在事务中原子完成，避免 race condition
    const perm = await db.transaction(async (tx) => {
      const existing = await tx.select({ id: schema.permissions.id })
        .from(schema.permissions)
        .where(eq(schema.permissions.code, v.data.code))
        .limit(1);
      if (existing[0]) throw new DuplicateEntityError('Permission', 'code');

      const p = createPermission(v.data, generateUUID);
      await tx.insert(schema.permissions).values(permissionToInsertRow(p));
      return p;
    });

    invalidateResource('permissions');
    return { success: true, data: { id: perm.id }, message: '权限创建成功' };
  },
);

/** 更新权限 */
export const updatePermissionAction = withAuth(
  { permissions: [PERMISSION_PERMISSIONS.UPDATE], audit: 'PERMISSION_UPDATE' },
  async (_ctx: AuthContext, permId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdatePermissionInputSchema, input);
    if (!v.ok) return v.response;

    await db.transaction(async (tx) => {
      const row = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.id, permId),
      });
      if (!row) throw new EntityNotFoundError('Permission', permId);

      const updated = applyPermissionUpdate(permissionFromPersistence(row), v.data);

      await tx.update(schema.permissions).set(permissionToUpdateRow(updated))
        .where(eq(schema.permissions.id, row.id));
      return updated;
    });

    // 权限变更影响所有绑定了该权限的角色 → 这些角色的用户必须收敛（撤销 AT + 刷缓存）
    await revokeAndRefreshAuthorization(await getAffectedUserIds(permId));

    invalidateResource('permissions');
    return { success: true, data: { id: permId }, message: '权限更新成功' };
  },
);

/** 删除权限 */
export const deletePermissionAction = withAuth(
  { permissions: [PERMISSION_PERMISSIONS.DELETE], audit: 'PERMISSION_DELETE' },
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

    await revokeAndRefreshAuthorization(affectedUserIds);

    invalidateResource('permissions');
    return { success: true, data: { id: permId }, message: '权限已删除' };
  },
);
