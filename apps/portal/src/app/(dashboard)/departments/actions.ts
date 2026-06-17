'use server';

/**
 * 部门管理 Server Actions (BFF 薄 Controller)
 *
 * 仅执行编排：Zod 门禁 → 领域纯函数 → Drizzle 直调。
 * 鉴权与领域错误映射统一由 withAuth 高阶函数施加。
 */
import { revalidatePath, revalidateTag } from 'next/cache';
import { db, schema } from '@/infrastructure/db';
import { eq, or } from 'drizzle-orm';
import { withAuth, type AuthContext } from '@/lib/auth';
import {
  createDepartment,
  departmentToInsertRow,
  departmentToUpdateRow,
  applyDepartmentUpdateWithCircularCheck,
  toDomainDepartment,
} from '@/domain/department/department';
import {
  CreateDepartmentInputSchema,
  UpdateDepartmentInputSchema,
  type CreateDepartmentInput,
} from '@/domain/department/types';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { generateId } from '@/lib/crypto';
import type { ApiResponse } from '@auth-sso/contracts';

/** 创建部门 */
export const createDepartmentAction = withAuth(
  { permissions: ['department:create'] },
  async (_ctx: AuthContext, input: CreateDepartmentInput): Promise<ApiResponse<{ id: string }>> => {
    const parsed = CreateDepartmentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
    }

    const dept = createDepartment(parsed.data, generateId);
    await db.insert(schema.departments).values(departmentToInsertRow(dept));

    revalidatePath('/departments');
    revalidateTag('departments-list', 'minutes');
    return { success: true, data: { id: dept.publicId }, message: '部门创建成功' };
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
        where: or(eq(schema.departments.id, deptId), eq(schema.departments.publicId, deptId)),
      });
      if (!row) throw new EntityNotFoundError('Department', deptId);

      const dept = toDomainDepartment(row);
      // 领域纯函数内部处理 parentId 变更检测与环形引用校验
      const allDepts = await tx.query.departments.findMany();
      const updated = applyDepartmentUpdateWithCircularCheck(dept, parsed.data, allDepts);

      await tx.update(schema.departments).set(departmentToUpdateRow(updated))
        .where(eq(schema.departments.id, dept.id));
    });

    revalidatePath('/departments');
    revalidateTag('departments-list', 'minutes');
    return { success: true, data: { id: deptId }, message: '部门更新成功' };
  },
);

/** 删除部门 */
export const deleteDepartmentAction = withAuth(
  { permissions: ['department:delete'] },
  async (_ctx: AuthContext, deptId: string): Promise<ApiResponse<{ id: string }>> => {
    await db.transaction(async (tx) => {
      const row = await tx.query.departments.findFirst({
        where: or(eq(schema.departments.id, deptId), eq(schema.departments.publicId, deptId)),
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
    revalidateTag('departments-list', 'minutes');
    return { success: true, data: { id: deptId }, message: '部门已删除' };
  },
);
