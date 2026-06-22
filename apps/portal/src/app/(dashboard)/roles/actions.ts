'use server';

/**
 * 角色管理 Server Actions (BFF 薄 Controller)
 */
import { revalidatePath, revalidateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createRole,
  roleToInsertRow,
  roleToUpdateRow,
  applyRoleUpdate,
  toDomainRole,
  guardNotSystemRole,
} from '@/domain/role/role';
import {
  CreateRoleInputSchema,
  UpdateRoleInputSchema,
  type CreateRoleInput,
} from '@/domain/role/types';
import { EntityNotFoundError, DuplicateEntityError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { refreshUsersPermissionCache } from '@/lib/permissions';
import type { ApiResponse } from '@auth-sso/contracts';

/** 获取绑定某角色的所有用户 ID，并主动刷新其权限缓存（删旧 → 查 DB → 写新） */
async function invalidateRoleBoundUsersCache(roleId: string): Promise<void> {
  const boundUsers = await db.select({ userId: schema.userRoles.userId })
    .from(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));
  if (boundUsers.length > 0) {
    await refreshUsersPermissionCache(boundUsers.map(u => u.userId));
  }
}

/** 创建角色 */
export const createRoleAction = withAuth(
  { permissions: ['role:create'] },
  async (_ctx: AuthContext, input: CreateRoleInput): Promise<ApiResponse<{ id: string }>> => {
    const parsed = CreateRoleInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    // 查重 + 插入在事务中原子完成，避免 race condition
    const role = await db.transaction(async (tx) => {
      const existing = await tx.select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.code, parsed.data.code))
        .limit(1);
      if (existing[0]) throw new DuplicateEntityError('Role', 'code');

      const r = createRole(parsed.data, generateUUID);
      await tx.insert(schema.roles).values(roleToInsertRow(r));
      return r;
    });

    revalidatePath('/roles');
    revalidateTag('roles-list', { expire: 0 });
    return { success: true, data: { id: role.id }, message: '角色创建成功' };
  },
);

/** 更新角色 */
export const updateRoleAction = withAuth(
  { permissions: ['role:update'] },
  async (_ctx: AuthContext, roleId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdateRoleInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    await db.transaction(async (tx) => {
      const row = await tx.query.roles.findFirst({ where: eq(schema.roles.id, roleId) });
      if (!row) throw new EntityNotFoundError('Role', roleId);

      const role = toDomainRole(row);
      guardNotSystemRole(role);

      const updated = applyRoleUpdate(role, parsed.data);
      await tx.update(schema.roles).set(roleToUpdateRow(updated))
        .where(eq(schema.roles.id, roleId));
    });

    await invalidateRoleBoundUsersCache(roleId);

    revalidatePath('/roles');
    revalidateTag('roles-list', { expire: 0 });
    return { success: true, data: { id: roleId }, message: '角色更新成功' };
  },
);

/** 删除角色 */
export const deleteRoleAction = withAuth(
  { permissions: ['role:delete'] },
  async (_ctx: AuthContext, roleId: string): Promise<ApiResponse<{ id: string }>> => {
    const row = await db.query.roles.findFirst({ where: eq(schema.roles.id, roleId) });
    if (!row) throw new EntityNotFoundError('Role', roleId);

    const role = toDomainRole(row);
    guardNotSystemRole(role);

    // 事务前预先获取绑定用户，事务后清除缓存
    const boundUsers = await db.select({ userId: schema.userRoles.userId })
      .from(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));

    await db.transaction(async (tx) => {
      await tx.delete(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
      await tx.delete(schema.roles).where(eq(schema.roles.id, roleId));
    });

    if (boundUsers.length > 0) {
      await refreshUsersPermissionCache(boundUsers.map(u => u.userId));
    }

    revalidatePath('/roles');
    revalidateTag('roles-list', { expire: 0 });
    return { success: true, data: { id: roleId }, message: '角色已删除' };
  },
);
