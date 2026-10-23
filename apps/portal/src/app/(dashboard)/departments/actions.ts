'use server';

/**
 * 部门管理 Server Actions (BFF 薄 Controller)
 *
 * 仅执行编排：Zod 门禁 → 领域纯函数 → Drizzle 直调。
 * 鉴权与领域错误映射统一由 withAuth 高阶函数施加。
 *
 * @impl F-DEP-C — 创建部门
 * @impl F-DEP-U — 编辑部门信息
 * @impl F-DEP-D — 删除部门
 */
import { schema } from '@/infrastructure/db';
import type { DbTxHandle } from '@/infrastructure/db';
import { eq, isNull, sql, count } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createDepartment,
  applyDepartmentUpdateWithCircularCheck,
  resolveParentAncestors,
  computeAncestorPrefix,
  validateDepartmentDeletable,
  departmentToInsertRow,
  departmentToUpdateRow,
  departmentFromPersistence,
} from '@/domain/department/department';
import {
  CreateDepartmentInputSchema,
  UpdateDepartmentInputSchema,
  type CreateDepartmentInput,
} from '@/domain/department/types';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { invalidateResource } from '@/lib/cache-invalidation';
import { resolveScope, withScopedRow, withScopedWrite } from '@/lib/authz';
import { assertDepartmentUsable } from '@/lib/department-availability';
import { DEPARTMENT_PERMISSIONS, type ApiResponse } from '@auth-sso/contracts';

/**
 * 根部门创建前的两道服务端守卫（H-21，UI 隐藏按钮不足以保证）。
 *
 * 1. **单例**（ADR-002 / `docs/roadmap.md` 2026-10-19）：根部门全局唯一。
 * 2. **空 targets 不得创建全局资源**：创建根部门时 `targets` 必然为空
 *    （没有父部门可施加范围断言），若不额外校验，任何持 `department:create`
 *    的部门范围操作员都能造出一个自己看不见、却落在所有角色子树之外的根。
 *    因此要求操作者自身具备非空数据范围（空范围 = 无任何部门授权）。
 *
 * 说明：空树引导期没有"已登录且持角色"的操作者（角色 `dept_id` NOT NULL 且外键
 * 引部门），所以这两条守卫不会阻塞首次播种；根部门由 seed 建立。
 */
async function assertRootCreationAllowed(tx: DbTxHandle, operatorId: string): Promise<void> {
  const existingRoot = await tx.query.departments.findFirst({
    where: isNull(schema.departments.parentId),
    columns: { id: true },
  });
  if (existingRoot) {
    throw new BusinessRuleViolationError('根部门已存在：根部门是 ADR-002 的单例，不能创建第二个根部门');
  }
  const scope = await resolveScope(tx, operatorId);
  if (scope.deptIds.length === 0) {
    throw new BusinessRuleViolationError('当前操作者没有部门数据范围，不能创建全局资源（根部门）');
  }
}

/** 创建部门 */
export const createDepartmentAction = withAuth(
  { permissions: [DEPARTMENT_PERMISSIONS.CREATE], audit: 'DEPARTMENT_CREATE' },
  async (ctx: AuthContext, input: CreateDepartmentInput): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(CreateDepartmentInputSchema, input);
    if (!v.ok) return v.response;

    const dept = await withScopedWrite(
      {
        operatorId: ctx.userId,
        // 子部门：父部门必须在操作者范围内；根部门：targets 为空，由 preflight 施加全局守卫
        targets: v.data.parentId
          ? [{ deptId: v.data.parentId, message: '无权在指定父部门下创建子部门' }]
          : [],
        // H-23：父部门必须存在且 ACTIVE（禁用部门是生命周期门禁，不追既往）
        preflight: (tx: DbTxHandle) => v.data.parentId
          ? assertDepartmentUsable(tx, v.data.parentId, '在其下创建子部门')
          : assertRootCreationAllowed(tx, ctx.userId),
      },
      async (tx) => {
      // 查询父级 ancestors 在事务内完成，消除读-写竞争窗口
      const parentAncestors = v.data.parentId
        ? await (async () => {
            const parent = await tx.query.departments.findFirst({
              where: eq(schema.departments.id, v.data.parentId!),
              columns: { id: true, ancestors: true },
            });
            return parent?.ancestors ?? null;
          })()
        : null;

      const d = createDepartment(v.data, generateUUID, parentAncestors);
      await tx.insert(schema.departments).values(departmentToInsertRow(d));
      return d;
    });

    invalidateResource('departments');
    return { success: true, data: { id: dept.id }, message: '部门创建成功' };
  },
);

/**
 * 内部辅助：执行部门更新 + 级联 ancestors 路径
 * 提取出 Controller 以减少主函数行数（R1 合规）
 */
async function performDepartmentUpdate(tx: DbTxHandle, deptId: string, patch: Record<string, unknown>): Promise<void> {
  const row = await tx.query.departments.findFirst({ where: eq(schema.departments.id, deptId) });
  if (!row) throw new EntityNotFoundError('Department', deptId);

  const allDepts = await tx.query.departments.findMany();
  const dept = departmentFromPersistence(row);
  const newAncestors = resolveParentAncestors(dept, patch.parentId as string | null | undefined, allDepts);

  const updated = applyDepartmentUpdateWithCircularCheck(dept, { ...patch, ancestors: newAncestors }, allDepts);
  await tx.update(schema.departments).set(departmentToUpdateRow(updated))
    .where(eq(schema.departments.id, dept.id));

  if (newAncestors !== undefined) {
    const oldPrefix = computeAncestorPrefix(dept.id, dept.ancestors);
    const newPrefix = computeAncestorPrefix(updated.id, updated.ancestors);
    if (oldPrefix !== newPrefix) {
      // H-B-02：`ancestors` 是**完整祖先链且不含自身**——"直接子部门"的 ancestors
      // 恰等于 `oldPrefix`（无后续 '/'），只写 `LIKE oldPrefix || '/%'` 会整体漏掉
      // 这一层：其 ancestors 残留旧链，进而让「新父部门的子树展开」漏掉它们
      // （fail-closed：移动后的部门管理员看不到直接子部门的人/角色/部门）。
      // 故等值分支必须与 LIKE 分支并列。REPLACE 对"恰等于 oldPrefix"的值同样成立。
      await tx.execute(sql`
        UPDATE departments
        SET ancestors = REPLACE(ancestors, ${oldPrefix}, ${newPrefix})
        WHERE ancestors = ${oldPrefix} OR ancestors LIKE ${oldPrefix + '/%'}
      `);
    }
  }
}

/**
 * 部门操作的数据范围守卫配置（**安全配置集中一处：改则全改**）
 *
 * 存在理由（#71 结构那一半）：这段 `load/deptOf/notFound/message` 组合原先在
 * 「更新部门」与「删除部门」两处逐字重复；安全配置散落时改一处漏一处就是越权。
 * 形状与 `users/actions.ts` 的 `loadUserScoped` 一致（同一纪律，不另立新词）。
 *
 * @param extraTargets 本次操作额外涉及的部门（如"拟迁入的父部门"），依赖已校验输入故以 thunk 传入
 */
function loadDepartmentScoped(
  operatorId: string,
  deptId: string,
  extraTargets?: () => Array<{ deptId: string; message: string }>,
) {
  return {
    operatorId,
    load: (tx: DbTxHandle) =>
      tx.query.departments.findFirst({ where: eq(schema.departments.id, deptId) }),
    deptOf: (row: { id: string }) => row.id,
    message: '无权操作该部门',
    ...(extraTargets ? { extraTargets } : {}),
    notFound: () => new EntityNotFoundError('Department', deptId),
  };
}

/** 更新部门 */
export const updateDepartmentAction = withAuth(
  { permissions: [DEPARTMENT_PERMISSIONS.UPDATE], audit: 'DEPARTMENT_UPDATE' },
  async (ctx: AuthContext, deptId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdateDepartmentInputSchema, input);
    if (!v.ok) return v.response;
    await withScopedRow(
      // 第二个目标：拟迁入的父部门（同一份快照，不重复读取）
      loadDepartmentScoped(ctx.userId, deptId, () => v.data.parentId
        ? [{ deptId: v.data.parentId, message: '无权将部门迁移至该父部门' }]
        : []),
      async (tx, row) => {
        // H-21：把已有部门迁出为新的根会破坏 ADR-002 的根部门单例
        // （`targets` 为空不构成限制，必须显式拒绝）。
        if (v.data.parentId === null && row.parentId !== null) {
          throw new BusinessRuleViolationError('根部门是 ADR-002 的单例：不能把已有部门迁出为新的根部门');
        }
        // H-23：迁入的父部门必须存在且 ACTIVE
        if (v.data.parentId) {
          await assertDepartmentUsable(tx, v.data.parentId, '将部门迁移至该父部门');
        }
        await performDepartmentUpdate(tx, deptId, v.data);
      },
    );
    invalidateResource('departments');
    return { success: true, data: { id: deptId }, message: '部门更新成功' };
  },
);

/** 删除部门 */
export const deleteDepartmentAction = withAuth(
  { permissions: [DEPARTMENT_PERMISSIONS.DELETE], audit: 'DEPARTMENT_DELETE' },
  async (ctx: AuthContext, deptId: string): Promise<ApiResponse<{ id: string }>> => {
    await withScopedRow(loadDepartmentScoped(ctx.userId, deptId),
      async (tx, row) => {
        // 检查是否有子部门
        const children = await tx.query.departments.findFirst({
          where: eq(schema.departments.parentId, row.id),
        });
        // v3.2: 检查是否有关联用户（DC-DEPT-D）
        const [userResult] = await tx
          .select({ count: count() })
          .from(schema.users)
          .where(eq(schema.users.deptId, row.id));
        // 检查是否有角色关联（v3.2: roles.dept_id FK）
        const [roleResult] = await tx
          .select({ count: count() })
          .from(schema.roles)
          .where(eq(schema.roles.deptId, row.id));

        validateDepartmentDeletable({
          // 根部门（parentId IS NULL）恒不可删——ADR-002 的承诺，此前从未实现
          isRoot: row.parentId === null,
          hasChildren: !!children,
          userCount: Number(userResult?.count || 0),
          roleCount: Number(roleResult?.count || 0),
        });

        await tx.delete(schema.departments).where(eq(schema.departments.id, row.id));
      },
    );

    invalidateResource('departments');
    return { success: true, data: { id: deptId }, message: '部门已删除' };
  },
);
