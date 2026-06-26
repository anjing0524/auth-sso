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

  // 单次批量 SQL 查询替代 N+1：对每个角色 deptId，匹配部门 id 或 ancestors 包含该 deptId
  const conditions = roleDeptIds.flatMap((deptId): ReturnType<typeof or>[] => [
    eq(schema.departments.id, deptId),
    like(schema.departments.ancestors, `${deptId}/%`),
  ]);
  const result = await db
    .select({ id: schema.departments.id })
    .from(schema.departments)
    .where(or(...conditions));
  return Array.from(new Set(result.map((r) => r.id)));
}

/**
 * 校验管理员是否有权访问目标部门下的数据（同步纯函数，零 I/O）
 *
 * 用于敏感写操作（重置密码、强制下线、角色绑定等）的数据范围守卫，
 * 避免跨部门越权（H-ACL-002 / H-DSCOPE-003）。
 *
 * deptIds 应来自 JWT claims.deptIds（已含子树展开），
 * 或由调用方通过 getUserRoleDeptIds() 预先获取。
 *
 * 规则：
 * - deptIds 为空 → 拒绝（无可见部门）
 * - 目标无部门（targetDeptId 为 null/undefined）→ 拒绝
 * - 目标部门不在 deptIds 集合内 → 拒绝
 *
 * @param deptIds 管理员可见的部门 ID 列表（已展开子树）
 * @param targetDeptId 被操作对象所属部门 ID
 * @returns true 表示有权访问
 */
export function canAccessDept(
  deptIds: string[],
  targetDeptId: string | null | undefined,
): boolean {
  if (!targetDeptId) return false;
  if (deptIds.length === 0) return false;
  return deptIds.includes(targetDeptId);
}
