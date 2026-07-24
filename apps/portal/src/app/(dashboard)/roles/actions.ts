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
import { eq } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createRole,
  applyRoleUpdate,
  guardNotSystemRole,
  hasRolePermissionImpact,
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
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
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
  { permissions: ['role:create'], audit: 'ROLE_CREATE' },
  async (ctx: AuthContext, input: CreateRoleInput): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(CreateRoleInputSchema, input);
    if (!v.ok) return v.response;

    // 数据范围校验：角色归属部门必须在操作者可访问范围内（R-ROLE-DEPT / R7）
    const deptIds = await getUserRoleDeptIds(ctx.userId);
    if (!canAccessDept(deptIds, v.data.deptId)) {
      throw new ForbiddenError('无权在指定部门下创建角色');
    }

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
      return r;
    });

    revalidatePath('/roles');
    updateTag('roles-list');
    return { success: true, data: { id: role.id }, message: '角色创建成功' };
  },
);

/** 更新角色 */
export const updateRoleAction = withAuth(
  { permissions: ['role:update'], audit: 'ROLE_UPDATE' },
  async (ctx: AuthContext, roleId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdateRoleInputSchema, input);
    if (!v.ok) return v.response;

    let permissionChanged = false;
    await db.transaction(async (tx) => {
      const row = await tx.query.roles.findFirst({ where: eq(schema.roles.id, roleId) });
      if (!row) throw new EntityNotFoundError('Role', roleId);
      // 数据范围校验：目标角色归属部门 + 拟变更部门均在操作者可访问范围内
      const deptIds = await getUserRoleDeptIds(ctx.userId);
      if (!canAccessDept(deptIds, row.deptId)) throw new ForbiddenError('无权操作该部门的角色');
      if (v.data.deptId && !canAccessDept(deptIds, v.data.deptId)) {
        throw new ForbiddenError('无权将角色迁移至该部门');
      }
      guardNotSystemRole(row);
      const updated = applyRoleUpdate(row, v.data);
      permissionChanged = hasRolePermissionImpact(row, updated);
      await tx.update(schema.roles).set(roleToUpdateRow(updated))
        .where(eq(schema.roles.id, roleId));
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
  { permissions: ['role:delete'], audit: 'ROLE_DELETE' },
  async (ctx: AuthContext, roleId: string): Promise<ApiResponse<{ id: string }>> => {
    const row = await db.query.roles.findFirst({ where: eq(schema.roles.id, roleId) });
    if (!row) throw new EntityNotFoundError('Role', roleId);
    // 数据范围校验：目标角色归属部门必须在操作者可访问范围内
    const deptIds = await getUserRoleDeptIds(ctx.userId);
    if (!canAccessDept(deptIds, row.deptId)) throw new ForbiddenError('无权操作该部门的角色');

    guardNotSystemRole(row);

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
      // 删除角色属于权限决策变更 → 批量撤销绑定用户 Access Token，强制重登解绑
      await revokeUsersAccessByUserId(boundUsers.map(u => u.userId));
    }

    revalidatePath('/roles');
    updateTag('roles-list');
    return { success: true, data: { id: roleId }, message: '角色已删除' };
  },
);
