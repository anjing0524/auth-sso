import 'server-only';

/**
 * 数据范围过滤子模块 (Data Scope)
 *
 * 职责：根据用户角色所属部门计算其数据访问范围，并为写操作提供作用域守卫。
 * 数据范围由角色所属部门（roles.dept_id）隐式决定，不再有 data_scope_type 枚举。
 *
 * @module lib/auth/data-scope
 */
import { eq, or, like } from 'drizzle-orm';
import { schema } from '@/infrastructure/db';
import type { DbExecutor } from '@/infrastructure/db';
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
 * 首参 executor 决定快照的连接归属：读路径/列表过滤传 `db`；
 * 事务内的写守卫传 `tx`——快照与写入在同一事务上执行，消除
 * "校验后、提交前操作者被降权"的 TOCTOU 窗口（H-ACL-002）。
 *
 * @param executor db 直连或事务句柄
 * @param userId 用户唯一标识 ID
 * @returns 部门 ID 列表（已去重、已展开子树）
 */
export async function getUserRoleDeptIds(executor: DbExecutor, userId: string): Promise<string[]> {
  const user = await executor.query.users.findFirst({
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

  // 单次批量 SQL 查询替代 N+1：对每个角色 deptId 展开其子树。
  //
  // `ancestors` 是**父链、不含自身**（见 domain/department.ts 的 computeAncestorPrefix）：
  // 根部门 null、一级子部门 = 根 ID、二级子部门 = `根/一级`。因此子树谓词必须是两条：
  //   1. `ancestors = deptId`      → 该部门的**直接**子部门（祖先恰等于 deptId）
  //   2. `ancestors LIKE deptId/%` → 更深层的后代
  // 只保留第 2 条会漏掉全部直接子部门，导致一级子部门在数据范围中"消失"。
  const conditions = roleDeptIds.flatMap((deptId): ReturnType<typeof or>[] => [
    // 部门自身
    eq(schema.departments.id, deptId),
    // 直接子部门：ancestors 恰为 deptId
    eq(schema.departments.ancestors, deptId),
    // 更深层后代：ancestors 以 `deptId/` 开头
    like(schema.departments.ancestors, `${deptId}/%`),
  ]);
  const result = await executor
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
 * deptIds 应通过 getUserRoleDeptIds() 获取（已含子树展开），
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

