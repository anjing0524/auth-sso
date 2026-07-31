'use server';

/**
 * 角色管理 Server Actions (BFF 薄 Controller)
 *
 * @impl C-ROL-C — 新建角色
 * @impl C-ROL-U — 编辑角色属性
 * @impl C-ROL-D — 删除角色
 * @impl C-ROL-PA — 为角色分配权限
 */
import { revalidatePath, updateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, inArray } from 'drizzle-orm';
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
import { EntityNotFoundError, DuplicateEntityError, ForbiddenError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { refreshUsersPermissionCache } from '@/lib/permissions';
import { revokeUsersAccessByUserId } from '@/lib/session/revoke';
import { canAccessDept, getUserRoleDeptIds } from '@/lib/auth';
import { ENTITY_ACTIVE, ROLE_PERMISSIONS } from '@auth-sso/contracts';
import type { ApiResponse } from '@auth-sso/contracts';
import { z } from 'zod';
import { appendSecurityAudit, getActionAuditContext } from '@/lib/audit';

const AssignPermissionsSchema = z.array(z.string().uuid()).max(500)
  .refine((ids) => new Set(ids).size === ids.length, '权限 ID 不可重复');

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
  { permissions: [ROLE_PERMISSIONS.CREATE] },
  async (ctx: AuthContext, input: CreateRoleInput): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(CreateRoleInputSchema, input);
    if (!v.ok) return v.response;

    // 数据范围校验：角色归属部门必须在操作者可访问范围内（R-ROLE-DEPT / R7）
    const deptIds = await getUserRoleDeptIds(ctx.userId);
    if (!canAccessDept(deptIds, v.data.deptId)) {
      throw new ForbiddenError('无权在指定部门下创建角色');
    }
    const auditContext = await getActionAuditContext();

    // 查重 + 部门存在性/ACTIVE 校验 + 插入在事务中原子完成
    const role = await db.transaction(async (tx) => {
      // 部门存在性 + ACTIVE 状态校验（DC-ROLE-C：不依赖 DB FK 兜底）
      const dept = await tx.query.departments.findFirst({
        where: eq(schema.departments.id, v.data.deptId),
        columns: { id: true, status: true },
      });
      if (!dept) throw new EntityNotFoundError('Department', v.data.deptId);
      if (dept.status !== ENTITY_ACTIVE) {
        throw new BusinessRuleViolationError('无法在已禁用的部门下创建角色');
      }

      const existing = await tx.select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.code, v.data.code))
        .limit(1);
      if (existing[0]) throw new DuplicateEntityError('Role', 'code');

      const r = createRole(v.data, generateUUID);
      await tx.insert(schema.roles).values(roleToInsertRow(r));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'ROLE_CREATE',
        targetType: 'role',
        targetId: r.id,
        targetName: r.name,
        changes: {
          code: { after: r.code },
          deptId: { after: r.deptId },
          status: { after: r.status },
        },
        ...auditContext,
      });
      return r;
    });

    revalidatePath('/roles');
    updateTag('roles-list');
    return { success: true, data: { id: role.id }, message: '角色创建成功' };
  },
);

/** 更新角色 */
export const updateRoleAction = withAuth(
  { permissions: [ROLE_PERMISSIONS.UPDATE] },
  async (ctx: AuthContext, roleId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdateRoleInputSchema, input);
    if (!v.ok) return v.response;

    let permissionChanged = false;
    const auditContext = await getActionAuditContext();
    await db.transaction(async (tx) => {
      const row = await tx.query.roles.findFirst({ where: eq(schema.roles.id, roleId) });
      if (!row) throw new EntityNotFoundError('Role', roleId);
      // 数据范围校验：目标角色归属部门 + 拟变更部门均在操作者可访问范围内
      const deptIds = await getUserRoleDeptIds(ctx.userId);
      if (!canAccessDept(deptIds, row.deptId)) throw new ForbiddenError('无权操作该部门的角色');
      if (v.data.deptId && !canAccessDept(deptIds, v.data.deptId)) {
        throw new ForbiddenError('无权将角色迁移至该部门');
      }
      const role = roleFromPersistence(row);
      guardNotSystemRole(role);
      const updated = applyRoleUpdate(role, v.data);
      permissionChanged = hasRolePermissionImpact(role, updated);
      await tx.update(schema.roles).set(roleToUpdateRow(updated))
        .where(eq(schema.roles.id, roleId));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'ROLE_UPDATE',
        targetType: 'role',
        targetId: roleId,
        targetName: updated.name,
        changes: {
          name: { before: row.name, after: updated.name },
          description: { before: row.description, after: updated.description },
          deptId: { before: row.deptId, after: updated.deptId },
          status: { before: row.status, after: updated.status },
        },
        ...auditContext,
      });
    });
    const userIds = await invalidateRoleBoundUsersCache(roleId);
    if (permissionChanged && userIds.length > 0) {
      await revokeUsersAccessByUserId(userIds);
    }

    revalidatePath('/roles');
    updateTag('roles-list');
    return { success: true, data: { id: roleId }, message: '角色更新成功' };
  },
);

/** 删除角色 */
export const deleteRoleAction = withAuth(
  { permissions: [ROLE_PERMISSIONS.DELETE] },
  async (ctx: AuthContext, roleId: string): Promise<ApiResponse<{ id: string }>> => {
    const deptIds = await getUserRoleDeptIds(ctx.userId);
    const auditContext = await getActionAuditContext();
    const boundUsers = await db.transaction(async (tx) => {
      const row = await tx.query.roles.findFirst({ where: eq(schema.roles.id, roleId) });
      if (!row) throw new EntityNotFoundError('Role', roleId);
      if (!canAccessDept(deptIds, row.deptId)) throw new ForbiddenError('无权操作该部门的角色');
      guardNotSystemRole(roleFromPersistence(row));
      const users = await tx.select({ userId: schema.userRoles.userId })
        .from(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));
      await tx.delete(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
      await tx.delete(schema.roles).where(eq(schema.roles.id, roleId));
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'ROLE_DELETE',
        targetType: 'role',
        targetId: roleId,
        targetName: row.name,
        params: { affectedUserCount: users.length },
        ...auditContext,
      });
      return users;
    });

    if (boundUsers.length > 0) {
      await refreshUsersPermissionCache(boundUsers.map(u => u.userId));
      // 删除角色属于权限决策变更 → 批量撤销绑定用户 Access Token，强制重登解绑
      await revokeUsersAccessByUserId(boundUsers.map(u => u.userId));
    }

    revalidatePath('/roles');
    updateTag('roles-list');
    return { success: true, data: { id: roleId }, message: '角色已删除' };
  },
);

/** 原子替换角色的 API 权限集合。 */
export const assignRolePermissionsAction = withAuth(
  { permissions: [ROLE_PERMISSIONS.ASSIGN_PERMISSION] },
  async (
    ctx: AuthContext,
    roleId: string,
    permissionIds: string[],
  ): Promise<ApiResponse<{ permissionIds: string[] }>> => {
    const parsed = validate(AssignPermissionsSchema, permissionIds);
    if (!parsed.ok) return parsed.response;
    const deptIds = await getUserRoleDeptIds(ctx.userId);
    const auditContext = await getActionAuditContext();

    const affectedUserIds = await db.transaction(async (tx) => {
      const role = await tx.query.roles.findFirst({
        where: eq(schema.roles.id, roleId),
        columns: { id: true, deptId: true },
      });
      if (!role) throw new EntityNotFoundError('Role', roleId);
      if (!canAccessDept(deptIds, role.deptId)) {
        throw new ForbiddenError('无权操作该部门的角色');
      }

      if (parsed.data.length > 0) {
        const permissions = await tx
          .select({
            id: schema.permissions.id,
            type: schema.permissions.type,
            status: schema.permissions.status,
          })
          .from(schema.permissions)
          .where(inArray(schema.permissions.id, parsed.data));
        if (
          permissions.length !== parsed.data.length
          || permissions.some((permission) =>
            permission.type !== 'API' || permission.status !== ENTITY_ACTIVE)
        ) {
          throw new BusinessRuleViolationError('角色只能绑定启用的 API 权限');
        }
      }

      const boundUsers = await tx
        .select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .where(eq(schema.userRoles.roleId, roleId));
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
      if (parsed.data.length > 0) {
        await tx.insert(schema.rolePermissions).values(
          parsed.data.map((permissionId) => ({ roleId, permissionId })),
        );
      }
      await appendSecurityAudit(tx, {
        userId: ctx.userId,
        operation: 'ROLE_PERMISSION_ASSIGN',
        targetType: 'role',
        targetId: roleId,
        params: { targetRoleId: roleId, permissionIds: parsed.data },
        changes: { permissionIds: { after: parsed.data } },
        ...auditContext,
      });
      return [...new Set(boundUsers.map((user) => user.userId))];
    });

    if (affectedUserIds.length > 0) {
      await refreshUsersPermissionCache(affectedUserIds);
      await revokeUsersAccessByUserId(affectedUserIds);
    }
    revalidatePath('/roles');
    updateTag('roles-list');
    return {
      success: true,
      data: { permissionIds: parsed.data },
      message: `已保存 ${parsed.data.length} 项权限`,
    };
  },
);
