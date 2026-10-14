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
import type { DbTxHandle } from '@/infrastructure/db';
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
import {
  refreshAuthorizationCache,
  revokeAndRefreshAuthorization,
} from '@/lib/auth/authorization-effects';
import { invalidateResource } from '@/lib/cache-invalidation';
import { withScopedRow, withScopedWrite } from '@/lib/authz';
import { ENTITY_ACTIVE, ROLE_PERMISSIONS } from '@auth-sso/contracts';
import type { ApiResponse } from '@auth-sso/contracts';

/** 查询绑定某角色的所有用户 ID（受影响用户集之一：按**角色**求） */
async function getRoleBoundUserIds(roleId: string): Promise<string[]> {
  const boundUsers = await db.select({ userId: schema.userRoles.userId })
    .from(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));
  return boundUsers.map((u) => u.userId);
}

/** 创建角色 */
export const createRoleAction = withAuth(
  { permissions: [ROLE_PERMISSIONS.CREATE], audit: 'ROLE_CREATE' },
  async (ctx: AuthContext, input: CreateRoleInput): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(CreateRoleInputSchema, input);
    if (!v.ok) return v.response;

    // 范围守卫 + 部门存在性/ACTIVE 校验 + 插入同一事务（ADR-014）
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

/**
 * 角色操作的数据范围守卫配置（**安全配置集中一处：改则全改**）
 *
 * 存在理由（#71 结构那一半）：这段 `load/deptOf/notFound/message` 组合原先在
 * 「更新角色」与「删除角色」两处逐字重复。安全配置散落时，**改一处而漏改另一处
 * 就是越权**——收成一处才能保证「改则全改」。
 *
 * 形状与 `users/actions.ts` 的 `loadUserScoped` 一致（同一纪律，不另立新词）。
 *
 * @param extraTargets 本次操作额外涉及的部门（如"拟迁入的部门"）。它依赖已校验的输入，
 *                     故以 thunk 传入——守卫在**同一份范围快照**上判定，不重复读取。
 */
function loadRoleScoped(
  operatorId: string,
  roleId: string,
  extraTargets?: () => Array<{ deptId: string; message: string }>,
) {
  return {
    operatorId,
    load: (tx: DbTxHandle) => tx.query.roles.findFirst({ where: eq(schema.roles.id, roleId) }),
    deptOf: (row: { deptId: string | null }) => row.deptId,
    message: '无权操作该部门的角色',
    ...(extraTargets ? { extraTargets } : {}),
    notFound: () => new EntityNotFoundError('Role', roleId),
  };
}

/** 更新角色 */
export const updateRoleAction = withAuth(
  { permissions: [ROLE_PERMISSIONS.UPDATE], audit: 'ROLE_UPDATE' },
  async (ctx: AuthContext, roleId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdateRoleInputSchema, input);
    if (!v.ok) return v.response;

    let permissionChanged = false;
    await withScopedRow(
      // 第二个目标：拟迁入部门（同一份快照，不重复读取）
      loadRoleScoped(ctx.userId, roleId, () => v.data.deptId
        ? [{ deptId: v.data.deptId, message: '无权将角色迁移至该部门' }]
        : []),
      async (tx, row) => {
        const role = roleFromPersistence(row);
        guardNotSystemRole(role, 'modify');
        const updated = applyRoleUpdate(role, v.data);
        permissionChanged = hasRolePermissionImpact(role, updated);
        await tx.update(schema.roles).set(roleToUpdateRow(updated))
          .where(eq(schema.roles.id, roleId));
      },
    );
    // 受影响用户集按角色求；是否收敛到"撤销 + 刷新"取决于这次更新有没有改变权限决策
    const userIds = await getRoleBoundUserIds(roleId);
    if (permissionChanged) {
      await revokeAndRefreshAuthorization(userIds);
    } else {
      // 仅改名/描述等不影响权限决策的变更：只刷缓存，不强制重登
      await refreshAuthorizationCache(userIds);
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
    await withScopedRow(loadRoleScoped(ctx.userId, roleId),
      async (tx, row) => {
        guardNotSystemRole(roleFromPersistence(row), 'delete');

        // 事务内删除前预取绑定用户，事务后清除缓存
        boundUsers = await tx.select({ userId: schema.userRoles.userId })
          .from(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));

        await tx.delete(schema.userRoles).where(eq(schema.userRoles.roleId, roleId));
        await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
        await tx.delete(schema.roles).where(eq(schema.roles.id, roleId));
      },
    );

    // 删除角色属于权限决策变更 → 绑定用户收敛（撤销 AT 强制重登 + 刷新缓存）
    await revokeAndRefreshAuthorization(boundUsers.map(u => u.userId));

    invalidateResource('roles');
    return { success: true, data: { id: roleId }, message: '角色已删除' };
  },
);
