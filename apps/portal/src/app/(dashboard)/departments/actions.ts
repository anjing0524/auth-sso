'use server';

/**
 * 部门管理 Server Actions (BFF 薄 Controller)
 *
 * 仅执行编排：Zod 门禁 → 领域纯函数 → Drizzle 直调。
 * 鉴权与领域错误映射统一由 withAuth 高阶函数施加。
 */
import { revalidatePath, updateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, sql, count } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createDepartment,
  applyDepartmentUpdateWithCircularCheck,
  resolveParentAncestors,
  computeAncestorPrefix,
  validateDepartmentDeletable,
  departmentToInsertRow,
  departmentToUpdateRow,
} from '@/domain/department/department';
import {
  CreateDepartmentInputSchema,
  UpdateDepartmentInputSchema,
  type CreateDepartmentInput,
} from '@/domain/department/types';
import { EntityNotFoundError, ForbiddenError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { validate } from '@/lib/validation';
import { canAccessDept, getUserRoleDeptIds } from '@/lib/auth';
import { type ApiResponse } from '@auth-sso/contracts';

/** 创建部门 */
export const createDepartmentAction = withAuth(
  { permissions: ['department:create'], audit: 'DEPARTMENT_CREATE' },
  async (ctx: AuthContext, input: CreateDepartmentInput): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(CreateDepartmentInputSchema, input);
    if (!v.ok) return v.response;

    // 数据范围校验：父部门必须在操作者可访问范围内（顶级部门 parentId 为 null 时放行）
    const deptIds = await getUserRoleDeptIds(ctx.userId);
    if (v.data.parentId && !canAccessDept(deptIds, v.data.parentId)) {
      throw new ForbiddenError('无权在指定父部门下创建子部门');
    }

    const dept = await db.transaction(async (tx) => {
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

    revalidatePath('/departments');
    updateTag('departments-list');
    return { success: true, data: { id: dept.id }, message: '部门创建成功' };
  },
);

/**
 * 内部辅助：执行部门更新 + 级联 ancestors 路径
 * 提取出 Controller 以减少主函数行数（R1 合规）
 */
type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function performDepartmentUpdate(tx: DrizzleTransaction, deptId: string, patch: Record<string, unknown>): Promise<void> {
  const row = await tx.query.departments.findFirst({ where: eq(schema.departments.id, deptId) });
  if (!row) throw new EntityNotFoundError('Department', deptId);

  const allDepts = await tx.query.departments.findMany();
  const dept = row;
  const newAncestors = resolveParentAncestors(dept, patch.parentId as string | null | undefined, allDepts);

  const updated = applyDepartmentUpdateWithCircularCheck(dept, { ...patch, ancestors: newAncestors }, allDepts);
  await tx.update(schema.departments).set(departmentToUpdateRow(updated))
    .where(eq(schema.departments.id, dept.id));

  if (newAncestors !== undefined) {
    const oldPrefix = computeAncestorPrefix(dept.id, dept.ancestors);
    const newPrefix = computeAncestorPrefix(updated.id, updated.ancestors);
    if (oldPrefix !== newPrefix) {
      await tx.execute(sql`UPDATE departments SET ancestors = REPLACE(ancestors, ${oldPrefix}, ${newPrefix}) WHERE ancestors LIKE ${oldPrefix + '/%'}`);
    }
  }
}

/** 更新部门 */
export const updateDepartmentAction = withAuth(
  { permissions: ['department:update'], audit: 'DEPARTMENT_UPDATE' },
  async (ctx: AuthContext, deptId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const v = validate(UpdateDepartmentInputSchema, input);
    if (!v.ok) return v.response;
    await db.transaction(async (tx) => {
      // 数据范围校验：目标部门 + 拟变更父部门均在操作者可访问范围内
      const deptIds = await getUserRoleDeptIds(ctx.userId);
      const row = await tx.query.departments.findFirst({ where: eq(schema.departments.id, deptId) });
      if (!row) throw new EntityNotFoundError('Department', deptId);
      if (!canAccessDept(deptIds, row.id)) throw new ForbiddenError('无权操作该部门');
      if (v.data.parentId && !canAccessDept(deptIds, v.data.parentId)) {
        throw new ForbiddenError('无权将部门迁移至该父部门');
      }
      await performDepartmentUpdate(tx, deptId, v.data);
    });
    revalidatePath('/departments');
    updateTag('departments-list');
    return { success: true, data: { id: deptId }, message: '部门更新成功' };
  },
);

/** 删除部门 */
export const deleteDepartmentAction = withAuth(
  { permissions: ['department:delete'], audit: 'DEPARTMENT_DELETE' },
  async (ctx: AuthContext, deptId: string): Promise<ApiResponse<{ id: string }>> => {
    await db.transaction(async (tx) => {
      const row = await tx.query.departments.findFirst({
        where: eq(schema.departments.id, deptId),
      });
      if (!row) throw new EntityNotFoundError('Department', deptId);
      // 数据范围校验：目标部门必须在操作者可访问范围内
      const deptIds = await getUserRoleDeptIds(ctx.userId);
      if (!canAccessDept(deptIds, row.id)) throw new ForbiddenError('无权操作该部门');

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
        hasChildren: !!children,
        userCount: Number(userResult?.count || 0),
        roleCount: Number(roleResult?.count || 0),
      });

      await tx.delete(schema.departments).where(eq(schema.departments.id, row.id));
    });

    revalidatePath('/departments');
    updateTag('departments-list');
    return { success: true, data: { id: deptId }, message: '部门已删除' };
  },
);
