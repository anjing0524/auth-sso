'use server';

/**
 * 权限管理 Server Actions (BFF 薄 Controller)
 *
 * 仅执行编排：Zod 门禁 → 领域纯函数 → Drizzle 直调；鉴权与错误映射由 `withAuth` 施加。
 *
 * ## 本文件承担的三条数据完整性不变量（2026-10-23 审计 H-19/H-20/H-B-01）
 *
 * 1. **code 不可变更**（D-PRM-U）：`ALL_PERMISSIONS` 里的码被 `checkPermission` /
 *    `route-access` 硬编码引用，改名会让非管理员在对应功能上 403，甚至通过 `portal:`
 *    前缀改写 OAuth client 准入。
 * 2. **parentId 不得成环**：父级不能是自身或自身后代；环会让 `menu-tree` 的
 *    `parentId=null` 递归永远到不了环内节点（菜单凭空消失）。
 * 3. **内置权限不可删除**：删除子树前按递归 CTE 取整棵子树，含 `ALL_PERMISSIONS`
 *    的码即拒绝；同时用同一棵子树求**受影响用户**做授权收敛——只收敛直接绑定者
 *    会让"仅绑定子权限"的用户在缓存 TTL 内继续持有已删除的权限（幽灵权限）。
 *
 * 类型转换（`type`）允许但必须归一：API↔菜单类型各自的专属字段由
 * `normalizePermissionTypeFields` 清理，避免撞 DB 的 `permissions_type_fields_chk`。
 *
 * @impl D-PRM-C — 注册新权限
 * @impl D-PRM-U — 编辑权限信息
 * @impl D-PRM-D — 删除权限
 */
import { db, schema } from '@/infrastructure/db';
import type { DbTxHandle } from '@/infrastructure/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createPermission,
  applyPermissionUpdate,
  normalizePermissionTypeFields,
  assertPermissionTypeFields,
  permissionFromPersistence,
  permissionToInsertRow,
  permissionToUpdateRow,
} from '@/domain/permission/permission';
import {
  CreatePermissionInputSchema,
  UpdatePermissionInputSchema,
} from '@/domain/permission/types';
import { EntityNotFoundError, DuplicateEntityError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { ALL_PERMISSIONS, COMMON_ERRORS, PORTAL_CLIENT_ID } from '@auth-sso/contracts';
import { revokeAndRefreshAuthorization } from '@/lib/auth/authorization-effects';
import { invalidateResource } from '@/lib/cache-invalidation';
import { PERMISSION_PERMISSIONS, type ApiResponse , PERMISSION_ERRORS } from '@auth-sso/contracts';

/**
 * 被服务端代码硬编码引用的核心权限码集合（`ALL_PERMISSIONS` 是唯一真相源）。
 *
 * 菜单（DIRECTORY/PAGE）权限刻意**不**在内：菜单节点本身就是可配置数据，管理员
 * 增删菜单属正常业务；而 API 权限码被 `checkPermission` 的常量引用，删除即全平台 403。
 */
const RESERVED_PERMISSION_CODES: ReadonlySet<string> = new Set<string>(ALL_PERMISSIONS);

/** 直接绑定某权限的用户（只用于 update：升级 code 前的旧实现，保留以覆盖"仅自身"场景） */
async function getAffectedUserIds(permId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
    .where(eq(schema.rolePermissions.permissionId, permId));
  return [...new Set(rows.map((r) => r.userId))];
}

/** 权限子树的完整视图（ids / codes / 受影响用户），一次递归 CTE 查询 */
interface PermissionSubtree {
  readonly ids: readonly string[];
  readonly codes: readonly string[];
  readonly affectedUserIds: readonly string[];
}

/**
 * 递归取权限子树及其绑定用户（与被删节点同一事务快照）。
 *
 * 存在的理由：`permissions.parent_id` 是 `ON DELETE CASCADE`，删除父节点会静默删掉
 * 整棵子树；若受影响用户只按"父节点自身绑定"计算，则仅绑定**后代**权限的用户
 * 不会被撤销/刷新，已删除的权限码在其 Redis 缓存（TTL≈1h）内继续放行。
 */
async function loadPermissionSubtree(executor: DbTxHandle, permId: string): Promise<PermissionSubtree> {
  const rows = await executor.execute<{ id: string; code: string; user_id: string | null }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id, code FROM permissions WHERE id = ${permId}
      UNION
      SELECT p.id, p.code FROM permissions p JOIN subtree s ON p.parent_id = s.id
    )
    SELECT s.id, s.code, ur.user_id
    FROM subtree s
    LEFT JOIN role_permissions rp ON rp.permission_id = s.id
    LEFT JOIN user_roles ur ON ur.role_id = rp.role_id
  `);
  const list = rows as unknown as Array<{ id: string; code: string; user_id: string | null }>;
  return {
    ids: [...new Set(list.map((r) => r.id))],
    codes: [...new Set(list.map((r) => r.code))],
    affectedUserIds: [...new Set(list.map((r) => r.user_id).filter((id): id is string => !!id))],
  };
}

/** 轻量子树 id 查询（环检测用；不 join 角色/用户表） */
async function loadSubtreeIds(executor: DbTxHandle, permId: string): Promise<string[]> {
  const rows = await executor.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM permissions WHERE id = ${permId}
      UNION
      SELECT p.id FROM permissions p JOIN subtree s ON p.parent_id = s.id
    )
    SELECT id FROM subtree
  `);
  return (rows as unknown as Array<{ id: string }>).map((r) => r.id);
}

/**
 * 校验 parentId 赋值不会制造环。
 *
 * @throws BusinessRuleViolationError 父级是自身或自身后代
 * @throws EntityNotFoundError       父级不存在（避免把它下沉成 500 的 FK 违例）
 */
async function assertParentAssignment(
  tx: DbTxHandle,
  permId: string,
  parentId: string | null | undefined,
): Promise<void> {
  if (parentId === undefined || parentId === null) return;
  if (parentId === permId) {
    throw new BusinessRuleViolationError('父级不能是权限自身');
  }
  const parent = await tx.query.permissions.findFirst({
    where: eq(schema.permissions.id, parentId),
    columns: { id: true },
  });
  if (!parent) throw new EntityNotFoundError('Permission', parentId);
  if ((await loadSubtreeIds(tx, permId)).includes(parentId)) {
    throw new BusinessRuleViolationError('父级不能设为自身的后代节点（会形成环）');
  }
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
      if (existing[0]) throw new DuplicateEntityError('权限', '编码', PERMISSION_ERRORS.PERMISSION_ALREADY_EXISTS);

      // Portal 管理页创建的权限都属于 portal 命名空间（PAGE/DIRECTORY 菜单，或 code 以 portal: 开头的 API）。
      // 之前 clientId 一直为 NULL ⇒ 角色带这些权限也拿不到 portal client 绑定，非管理员无法登录（权限审计 2026-10-21）。
      const clientBound = v.data.type === 'API'
        ? { ...v.data, clientId: v.data.clientId ?? (v.data.code.startsWith('portal:') ? PORTAL_CLIENT_ID : undefined) }
        : v.data;
      const p = createPermission(clientBound, generateUUID);
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
    // code 不可变更：显式拒绝（不静默忽略，避免调用方误以为改名成功）
    if (input && Object.prototype.hasOwnProperty.call(input, 'code')) {
      return {
        success: false,
        error: COMMON_ERRORS.VALIDATION_ERROR,
        message: '权限编码不可变更：如需调整编码请新建权限并迁移角色绑定',
      };
    }
    const v = validate(UpdatePermissionInputSchema, input);
    if (!v.ok) return v.response;

    await db.transaction(async (tx) => {
      const row = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.id, permId),
      });
      if (!row) throw new EntityNotFoundError('Permission', permId);

      await assertParentAssignment(tx, row.id, v.data.parentId);

      const merged = applyPermissionUpdate(permissionFromPersistence(row), v.data);
      // 类型转换归一（H-B-04）：先按 type 清理专属字段，再校验该类型必填字段
      const normalized = normalizePermissionTypeFields(merged);
      assertPermissionTypeFields(normalized);

      await tx.update(schema.permissions).set(permissionToUpdateRow(normalized))
        .where(eq(schema.permissions.id, row.id));
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
    // 收集受影响用户（含子树）与保留码校验必须与被删数据同一事务快照：
    // 否则"收集后、删除前"新增的绑定会漏收敛。
    const affectedUserIds = await db.transaction(async (tx) => {
      const row = await tx.query.permissions.findFirst({
        where: eq(schema.permissions.id, permId),
      });
      if (!row) throw new EntityNotFoundError('Permission', permId);

      const subtree = await loadPermissionSubtree(tx, permId);
      const reserved = subtree.codes.filter((code) => RESERVED_PERMISSION_CODES.has(code));
      if (reserved.length > 0) {
        const sample = reserved.slice(0, 3).join('、');
        const suffix = reserved.length > 3 ? ` 等 ${reserved.length} 个` : '';
        throw new BusinessRuleViolationError(
          `内置权限不可删除（${sample}${suffix}被服务端代码引用）；如需停用请将 status 置为 DISABLED`,
        );
      }

      // 显式清理整棵子树的角色绑定（DB CASCADE 也会删，但显式化让"影响范围"可读且不依赖 FK 行为）
      await tx.delete(schema.rolePermissions)
        .where(inArray(schema.rolePermissions.permissionId, [...subtree.ids]));
      await tx.delete(schema.permissions).where(eq(schema.permissions.id, row.id));
      return subtree.affectedUserIds;
    });

    await revokeAndRefreshAuthorization([...affectedUserIds]);

    invalidateResource('permissions');
    return { success: true, data: { id: permId }, message: '权限已删除' };
  },
);
