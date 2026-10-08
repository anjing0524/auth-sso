'use server';

/**
 * 角色管理 Server Actions (BFF 薄 Controller)
 *
 * @impl C-ROL-C — 新建角色
 * @impl C-ROL-U — 编辑角色属性
 * @impl C-ROL-D — 删除角色
 * @impl C-ROL-PA — 为角色分配权限
 */
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createRole,
  applyRoleUpdate,
  guardNotSystemRole,
  hasRolePermissionImpact,
  roleFromPersistence,
  roleToInsertRow,
  roleToUpdateRow,
} from '@/domain/role/role';
import {
  CreateRoleInputSchema,
  UpdateRoleInputSchema,
  type CreateRoleInput,
} from '@/domain/role/types';
import { EntityNotFoundError, DuplicateEntityError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { refreshUsersPermissionCache } from '@/lib/permissions';
import { revokeUsersAccessByUserId } from '@/lib/session/revoke';
import { invalidateResource } from '@/lib/cache-invalidation';
import { withScopedRow, withScopedWrite } from '@/lib/authz';
import { ENTITY_ACTIVE, ROLE_PERMISSIONS } from '@auth-sso/contracts';
import type { ApiResponse } from '@auth-sso/contracts';

/** 查询绑定某角色的所有用户 ID */
async function getRoleBoundUserIds(roleId: string): Promise<string[]> {
  const boundUsers = await db.select({ userId: schema.userRoles.userId })
    .from(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));
  return boundUsers.map((u) => u.userId);
}

/** 获取绑定某角色的所有用户 ID，并主动刷新其权限缓存（删旧 → 查 DB → 写新） */
async function invalidateRoleBoundUsersCache(roleId: string): Promise<string[]> {
  const userIds = await getRoleBoundUserIds(roleId);
  if (userIds.length > 0) {
    await refreshUsersPermissionCache(userIds);
  }
  return userIds;
}

/** 创建角色 */
export const createRoleAction = withAuth(
  { permissions: [ROLE_PERMISSIONS.CREATE], audit: 'ROLE_CREATE' },
  async (ctx: AuthContext, input: CreateRoleInput): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(CreateRoleInputSchema, input);
    if (!v.ok) return v.response;

    // 范围守卫 + 部门存在性/ACTIVE 校验 + 插入同一事务（ADR-019）
    const role = await withScopedWrite(
      {
        operatorId: ctx.userId,
        targets: [{ deptId: v.data.deptId, message: '无权在指定部门下创建角色' }],
        // 存在性/状态校验在守卫之前：不存在的部门必须 404，不能退化成 403
        preflight: async (tx) => {
          const dept = await tx.query.departments.findFirst({
            where: eq(schema.departments.id, v.data.deptId),
            columns: { id: true, status: true },
          });
          if (!dept) throw new EntityNotFoundError('Department', v.data.deptId);
          if (dept.status !== ENTITY_ACTIVE) {
            throw new BusinessRuleViolationError('无法在已禁用的部门下创建角色');
          }
        },
      },
      async (tx) => {
        const existing = await tx.select({ id: schema.roles.id })
          .from(schema.roles)
          .where(eq(schema.roles.code, v.data.code))
          .limit(1);
        if (existing[0]) throw new DuplicateEntityError('Role', 'code');

        const r = createRole(v.data, generateUUID);
        await tx.insert(schema.roles).values(roleToInsertRow(r));
        return r;
      },
    );

    invalidateResource('roles');
    return { success: true, data: { id: role.id }, message: '角色创建成功' };
  },
);

/** 更新角色 */
export const updateRoleAction = withAuth(
  { permissions: [ROLE_PERMISSIONS.UPDATE], audit: 'ROLE_UPDATE' },
  async (ctx: AuthContext, roleId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdateRoleInputSchema, input);
    if (!v.ok) return v.response;

    let permissionChanged = false;
    await withScopedRow(
      {
        operatorId: ctx.userId,
        load: (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, roleId) }),
        deptOf: (row) => row.deptId,
        message: '无权操作该部门的角色',
        // 第二个目标：拟迁入部门（同一份快照，不重复读取）
        extraTargets: () => v.data.deptId
          ? [{ deptId: v.data.deptId, message: '无权将角色迁移至该部门' }]
          : [],
        notFound: () => new EntityNotFoundError('Role', roleId),
      },
      async (tx, row) => {
        const role = roleFromPersistence(row);
        guardNotSystemRole(role);
        const updated = applyRoleUpdate(role, v.data);
        permissionChanged = hasRolePermissionImpact(role, updated);
        await tx.update(schema.roles).set(roleToUpdateRow(updated))
          .where(eq(schema.roles.id, roleId));
      },
    );
    const userIds = await invalidateRoleBoundUsersCache(roleId);
    if (permissionChanged && userIds.length > 0) {
      await revokeUsersAccessByUserId(userIds);
    }

    invalidateResource('roles');
    return { success: true, data: { id: roleId }, message: '角色更新成功' };
  },
);

/** 删除角色 */
export const deleteRoleAction = withAuth(
  { permissions: [ROLE_PERMISSIONS.DELETE], audit: 'ROLE_DELETE' },
  async (ctx: AuthContext, roleId: string): Promise<ApiResponse<{ id: string }>> => {
    let boundUsers: Array<{ userId: string }> = [];
    await withScopedRow(
      {
        operatorId: ctx.userId,
        load: (tx) => tx.query.roles.findFirst({ where: eq(schema.roles.id, roleId) }),
        deptOf: (row) => row.deptId,
        message: '无权操作该部门的角色',
        notFound: () => new EntityNotFoundError('Role', roleId),
      },
      async (tx, row) => {
        guardNotSystemRole(roleFromPersistence(row));

        // 事务内删除前预取绑定用户，事务后清除缓存
        boundUsers = await tx.select({ userId: schema.userRoles.userId })
          .from(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));

        await tx.delete(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));
        await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
        await tx.delete(schema.roles).where(eq(schema.roles.id, roleId));
      },
    );

    if (boundUsers.length > 0) {
      await refreshUsersPermissionCache(boundUsers.map(u => u.userId));
      // 删除角色属于权限决策变更 → 批量撤销绑定用户 Access Token，强制重登解绑
      await revokeUsersAccessByUserId(boundUsers.map(u => u.userId));
    }

    invalidateResource('roles');
    return { success: true, data: { id: roleId }, message: '角色已删除' };
  },
);
