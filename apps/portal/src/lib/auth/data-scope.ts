import 'server-only';

/**
 * 数据范围过滤子模块 (Data Scope)
 *
 * 职责：根据用户角色所属部门计算其数据访问范围。
 * 数据范围由角色所属部门（roles.dept_id）隐式决定，不再有 data_scope_type 枚举。
 *
 * @module lib/auth/data-scope
 */
import { eq, or, like } from 'drizzle-orm';
import { db, schema } from '@/infrastructure/db';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';

/**
 * 通过物化路径 (ancestors) 查询本部门及其全部子部门 ID
 *
 * 查询异常时故障安全降级为仅当前部门（Default-Deny 最小权限）。
 *
 * @param deptId 根部门 ID
 * @returns 本部门 + 子部门 ID 列表；异常时返回 `[deptId]`
 */
async function getSubDepartmentIds(deptId: string): Promise<string[]> {
  try {
    const result = await db
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(
        or(
          eq(schema.departments.id, deptId),
          like(schema.departments.ancestors, `${deptId}/%`),
        ),
      );
    return result.map((r) => r.id);
  } catch (error) {
    console.error('[DataScope] getSubDepartmentIds 查询异常:', error);
    return [deptId];
  }
}

/**
 * 获取用户可访问的部门 ID 列表（含子树展开）
 *
 * 两步计算逻辑：
 * 1. 查询用户所有角色的 dept_id（通过 user_roles → roles.dept_id）
 * 2. 对每个 dept_id，通过物化路径 ancestors LIKE 展开子树
 * 3. 去重后返回部门 ID 数组
 *
 * 无角色时返回空数组（表示无数据访问权限）。
 *
 * @param userId 用户唯一标识 ID
 * @returns 部门 ID 列表（已去重、已展开子树）
 */
export async function getUserRoleDeptIds(userId: string): Promise<string[]> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    with: {
      userRoles: {
        with: {
          role: {
            columns: { deptId: true, status: true },
          },
        },
      },
    },
  });

  if (!user) return [];

  // v3.2: 只取 ACTIVE 角色的 dept_id，与 getUserPermissionContext 保持一致
  const roleDeptIds = Array.from(
    new Set(
      user.userRoles
        .filter(ur => ur.role !== null && ur.role.status === ENTITY_ACTIVE)
        .map(ur => ur.role!.deptId)
        .filter((id): id is string => !!id),
    ),
  );

  if (roleDeptIds.length === 0) return [];

  // 对每个 dept_id 展开子树，汇总去重
  const allDeptIds = await Promise.all(
    roleDeptIds.map(deptId => getSubDepartmentIds(deptId)),
  );

  return Array.from(new Set(allDeptIds.flat()));
}
