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
import { EntityNotFoundError, BusinessRuleViolationError, ForbiddenError } from '@/domain/shared/errors';
import { generateUUID } from '@/lib/crypto';
import { canAccessDept } from '@/lib/auth';
import { COMMON_ERRORS, type ApiResponse } from '@auth-sso/contracts';

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
  { permissions: ['department:create'], audit: 'DEPARTMENT_CREATE' },
  async (ctx: AuthContext, input: CreateDepartmentInput): Promise<ApiResponse<{ id: string }>> => {
    const parsed = CreateDepartmentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message };
    }

    // 数据范围校验：父部门必须在操作者可访问范围内（顶级部门 parentId 为 null 时放行）
    if (parsed.data.parentId && !canAccessDept(ctx.claims.deptIds, parsed.data.parentId)) {
      throw new ForbiddenError('无权在指定父部门下创建子部门');
    }

    // 查询父级的 ancestors 以计算物化路径
    const parentAncestors = parsed.data.parentId
      ? await getParentAncestors(parsed.data.parentId)
      : null;

    const dept = createDepartment(parsed.data, generateUUID, parentAncestors);
    await db.insert(schema.departments).values(departmentToInsertRow(dept));

    revalidatePath('/departments');
    updateTag('departments-list');
    return { success: true, data: { id: dept.id }, message: '部门创建成功' };
  },
);

/**
 * 内部辅助：执行部门更新 + 级联 ancestors 路径
 * 提取出 Controller 以减少主函数行数（R1 合规）
 */
async function performDepartmentUpdate(tx: any, deptId: string, patch: Record<string, unknown>): Promise<void> {
  const row = await tx.query.departments.findFirst({ where: eq(schema.departments.id, deptId) });
  if (!row) throw new EntityNotFoundError('Department', deptId);

  const dept = toDomainDepartment(row);
  const allDepts = await tx.query.departments.findMany();
  const newAncestors = resolveParentAncestors(dept, patch.parentId as string | null | undefined, allDepts);
  const parentChanged = newAncestors !== undefined;

  const mergedPatch = { ...patch, ...(parentChanged ? { ancestors: newAncestors } : {}) };
  const updated = applyDepartmentUpdateWithCircularCheck(dept, mergedPatch, allDepts);
  await tx.update(schema.departments).set(departmentToUpdateRow(updated)).where(eq(schema.departments.id, dept.id));

  if (parentChanged) {
    const oldPrefix = dept.ancestors ? `${dept.ancestors}/${dept.id}` : dept.id;
    const newPrefix = updated.ancestors ? `${updated.ancestors}/${updated.id}` : updated.id;
    if (oldPrefix !== newPrefix) {
      await tx.execute(sql`UPDATE departments SET ancestors = REPLACE(ancestors, ${oldPrefix}, ${newPrefix}) WHERE ancestors LIKE ${oldPrefix + '/%'}`);
    }
  }
}

/** 更新部门 */
export const updateDepartmentAction = withAuth(
  { permissions: ['department:update'], audit: 'DEPARTMENT_UPDATE' },
  async (ctx: AuthContext, deptId: string, input: Record<string, unknown>): Promise<ApiResponse<{ id: string }>> => {
    const parsed = UpdateDepartmentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message };
    }
    await db.transaction(async (tx) => {
      // 数据范围校验：目标部门 + 拟变更父部门均在操作者可访问范围内
      const row = await tx.query.departments.findFirst({ where: eq(schema.departments.id, deptId) });
      if (!row) throw new EntityNotFoundError('Department', deptId);
      if (!canAccessDept(ctx.claims.deptIds, row.id)) throw new ForbiddenError('无权操作该部门');
      if (parsed.data.parentId && !canAccessDept(ctx.claims.deptIds, parsed.data.parentId)) {
        throw new ForbiddenError('无权将部门迁移至该父部门');
      }
      await performDepartmentUpdate(tx, deptId, parsed.data);
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
      if (!canAccessDept(ctx.claims.deptIds, row.id)) throw new ForbiddenError('无权操作该部门');

      // 检查是否有子部门
      const children = await tx.query.departments.findFirst({
        where: eq(schema.departments.parentId, row.id),
      });
      if (children) throw new BusinessRuleViolationError('该部门下有子部门，无法删除');

      // v3.2: 检查是否有关联用户（DC-DEPT-D）
      const userCount = await tx
        .select({ count: count() })
        .from(schema.users)
        .where(eq(schema.users.deptId, row.id));
      if (Number(userCount[0]?.count || 0) > 0) {
        throw new BusinessRuleViolationError('该部门下存在关联用户，无法删除');
      }

      // 检查是否有角色关联（v3.2: roles.dept_id FK）
      const roleCount = await tx
        .select({ count: count() })
        .from(schema.roles)
        .where(eq(schema.roles.deptId, row.id));
      if (Number(roleCount[0]?.count || 0) > 0) {
        throw new BusinessRuleViolationError('该部门下存在关联角色，无法删除');
      }

      await tx.delete(schema.departments).where(eq(schema.departments.id, row.id));
    });

    revalidatePath('/departments');
    updateTag('departments-list');
    return { success: true, data: { id: deptId }, message: '部门已删除' };
  },
);
