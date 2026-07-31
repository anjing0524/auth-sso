'use server';

/**
 * 权限管理 Server Actions (BFF 薄 Controller)
 *
 * @impl D-PRM-C — 注册新权限
 * @impl D-PRM-U — 编辑权限信息
 * @impl D-PRM-D — 删除权限
 */
import { revalidatePath, updateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import { createPermission, applyPermissionUpdate, permissionFromPersistence, permissionToInsertRow, permissionToUpdateRow } from '@/domain/permission/permission';
import {
  CreatePermissionInputSchema,
  UpdatePermissionInputSchema,
} from '@/domain/permission/types';
import {
  BusinessRuleViolationError,
  EntityNotFoundError,
  DuplicateEntityError,
} from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { refreshUsersPermissionCache } from '@/lib/permissions';
import { revokeUsersAccessByUserId } from '@/lib/session/revoke';
import { PERMISSION_PERMISSIONS, type ApiResponse } from '@auth-sso/contracts';
import { appendSecurityAudit, getActionAuditContext } from '@/lib/audit';

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
  { permissions: [PERMISSION_PERMISSIONS.CREATE] },
  async (ctx: AuthContext, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(CreatePermissionInputSchema, input);
    if (!v.ok) return v.response;

    const auditContext = await getActionAuditContext();
    const perm = await db.transaction(async (tx) => {
      const existing = await tx.select({ id: schema.permissions.id })
        .from(schema.permissions)
        .where(eq(schema.permissions.code, v.data.code))
        .limit(1);
      if (existing[0]) throw new DuplicateEntityError('Permission', 'code');

      const p = createPermission(v.data, generateUUID);
      await tx.insert(schema.permissions).values(permissionToInsertRow(p));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'PERMISSION_CREATE',
        targetType: 'permission',
        targetId: p.id,
        targetName: p.name,
        changes: {
          code: { after: p.code },
          type: { after: p.type },
          status: { after: p.status },
        },
        ...auditContext,
      });
      return p;
    });

    revalidatePath('/permissions');
    updateTag('permissions-list');
    return { success: true, data: { id: perm.id }, message: '权限创建成功' };
  },
);

/** 更新权限 */
export const updatePermissionAction = withAuth(
  { permissions: [PERMISSION_PERMISSIONS.UPDATE] },
  async (ctx: AuthContext, permId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdatePermissionInputSchema, input);
    if (!v.ok) return v.response;

    const auditContext = await getActionAuditContext();
    await db.transaction(async (tx) => {
      const row = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.id, permId),
      });
      if (!row) throw new EntityNotFoundError('Permission', permId);
      if (v.data.code !== undefined && v.data.code !== row.code) {
        throw new BusinessRuleViolationError('权限编码创建后不可修改');
      }
      if (v.data.type !== undefined && v.data.type !== row.type) {
        throw new BusinessRuleViolationError('权限类型创建后不可修改');
      }

      const updated = applyPermissionUpdate(permissionFromPersistence(row), v.data);

      await tx.update(schema.permissions).set(permissionToUpdateRow(updated))
        .where(eq(schema.permissions.id, row.id));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'PERMISSION_UPDATE',
        targetType: 'permission',
        targetId: row.id,
        targetName: updated.name,
        changes: {
          name: { before: row.name, after: updated.name },
          description: { before: row.description, after: updated.description },
          status: { before: row.status, after: updated.status },
        },
        ...auditContext,
      });
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
  { permissions: [PERMISSION_PERMISSIONS.DELETE] },
  async (ctx: AuthContext, permId: string): Promise<ApiResponse<{ id: string }>> => {
    const auditContext = await getActionAuditContext();
    const affectedUserIds = await db.transaction(async (tx) => {
      const row = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.id, permId),
      });
      if (!row) throw new EntityNotFoundError('Permission', permId);
      const affectedUsers = await tx
        .select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
        .where(eq(schema.rolePermissions.permissionId, permId));
      const menuReferences = await tx
        .update(schema.permissions)
        .set({ requiredPermissionId: null })
        .where(eq(schema.permissions.requiredPermissionId, permId))
        .returning({ id: schema.permissions.id });
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.permissionId, row.id));
      await tx.delete(schema.permissions).where(eq(schema.permissions.id, row.id));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'PERMISSION_DELETE',
        targetType: 'permission',
        targetId: row.id,
        targetName: row.name,
        params: { affectedMenuCount: menuReferences.length },
        ...auditContext,
      });
      return [...new Set(affectedUsers.map((user) => user.userId))];
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
