'use server';

/**
 * 部门管理 Server Actions (BFF 薄 Controller)
 *
 * 仅执行编排：Zod 门禁 → 领域纯函数 → Drizzle 直调。
 * 鉴权与领域错误映射统一由 withAuth 高阶函数施加。
 */
import { revalidatePath, revalidateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, sql } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createDepartment,
  departmentToInsertRow,
  departmentToUpdateRow,
  applyDepartmentUpdateWithCircularCheck,
  resolveParentAncestors,
  toDomainDepartment,
} from '@/domain/department/department';
import {
  CreateDepartmentInputSchema,
  UpdateDepartmentInputSchema,
  type CreateDepartmentInput,
} from '@/domain/department/types';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import type { ApiResponse } from '@auth-sso/contracts';

/**
 * 查询父级部门的 ancestors，用于计算新部门的物化路径
 * @returns 父级的 ancestors（顶级为 null），父级不存在时返回 null
 */
async function getParentAncestors(parentId: string): Promise<string | null> {
  const parent = await db.query.departments.findFirst({
    where: eq(schema.departments.id, parentId),
    columns: { id: true, ancestors: true },
  });
  return parent?.ancestors ?? null;
}

/** 创建部门 */
export const createDepartmentAction = withAuth(
  { permissions: ['department:create'] },
  async (_ctx: AuthContext, input: CreateDepartmentInput): Promise<ApiResponse<{ id: string }>> => {
    const parsed = CreateDepartmentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    // 查询父级的 ancestors 以计算物化路径
    const parentAncestors = parsed.data.parentId
      ? await getParentAncestors(parsed.data.parentId)
      : null;

    const dept = createDepartment(parsed.data, generateUUID, parentAncestors);
    await db.insert(schema.departments).values(departmentToInsertRow(dept));

    revalidatePath('/departments');
    revalidateTag('departments-list', { expire: 0 });
    return { success: true, data: { id: dept.id }, message: '部门创建成功' };
  },
);

/** 更新部门 */
export const updateDepartmentAction = withAuth(
  { permissions: ['department:update'] },
  async (_ctx: AuthContext, deptId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdateDepartmentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    await db.transaction(async (tx) => {
      const row = await tx.query.departments.findFirst({
        where: eq(schema.departments.id, deptId),
      });
      if (!row) throw new EntityNotFoundError('Department', deptId);

      const dept = toDomainDepartment(row);
      const allDepts = await tx.query.departments.findMany();

      // 领域纯函数：parentId 变更时自动计算新 ancestors（消除了 Controller 的 if/else 分支）
      const newAncestors = resolveParentAncestors(dept, parsed.data.parentId, allDepts);
      const parentChanged = newAncestors !== undefined;

      const patch = { ...parsed.data, ...(parentChanged ? { ancestors: newAncestors } : {}) };
      const updated = applyDepartmentUpdateWithCircularCheck(dept, patch, allDepts);

      await tx.update(schema.departments).set(departmentToUpdateRow(updated))
        .where(eq(schema.departments.id, dept.id));

      // parentId 变更时，级联更新所有子孙节点的物化路径（DB 级操作，保留在 Controller）
      if (parentChanged) {
        const oldPrefix = dept.ancestors ? `${dept.ancestors}/${dept.id}` : dept.id;
        const newPrefix = updated.ancestors ? `${updated.ancestors}/${updated.id}` : updated.id;
        if (oldPrefix !== newPrefix) {
          await tx.execute(sql`
            UPDATE departments
            SET ancestors = REPLACE(ancestors, ${oldPrefix}, ${newPrefix})
            WHERE ancestors LIKE ${oldPrefix + '/%'}
          `);
        }
      }
    });

    revalidatePath('/departments');
    revalidateTag('departments-list', { expire: 0 });
    return { success: true, data: { id: deptId }, message: '部门更新成功' };
  },
);

/** 删除部门 */
export const deleteDepartmentAction = withAuth(
  { permissions: ['department:delete'] },
  async (_ctx: AuthContext, deptId: string): Promise<ApiResponse<{ id: string }>> => {
    await db.transaction(async (tx) => {
      const row = await tx.query.departments.findFirst({
        where: eq(schema.departments.id, deptId),
      });
      if (!row) throw new EntityNotFoundError('Department', deptId);

      // 检查是否有子部门
      const children = await tx.query.departments.findFirst({
        where: eq(schema.departments.parentId, row.id),
      });
      if (children) throw new BusinessRuleViolationError('该部门下有子部门，无法删除');

      await tx.delete(schema.departments).where(eq(schema.departments.id, row.id));
    });

    revalidatePath('/departments');
    revalidateTag('departments-list', { expire: 0 });
    return { success: true, data: { id: deptId }, message: '部门已删除' };
  },
);
