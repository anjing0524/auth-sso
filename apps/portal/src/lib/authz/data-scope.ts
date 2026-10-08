import 'server-only';

/**
 * 数据范围（Data Scope）授权门面 — Scope 与纯判定
 *
 * 本模块是 OBAC 数据范围（ADR-002）授权的**唯一门面**（PDP/PEP，ADR-014）。
 *
 * 存在的理由：范围过滤与越界守卫曾以两种形状散落在 28 个调用点——
 * `requireDeptAccess(tx, ...)`（正确）与手写 `getUserRoleDeptIds + canAccessDept`
 * （13 处 REST，其中 8 处在事务外取快照 = TOCTOU）。同一项目内两种形状导致两种
 * 正确性，证明缺陷源于 interface 允许了错误用法，而非开发者疏忽。
 *
 * 因此本模块**不导出** `getUserRoleDeptIds` / `canAccessDept` / `requireDeptAccess`：
 * - 写路径只能经 {@link withScopedWrite}（快照与写入同事务，不可分开）
 * - 读路径只能用 {@link scopeFilter} 构造过滤条件（空范围恒 `FALSE`）
 *
 * @module lib/authz/data-scope
 */
import type { DbExecutor } from '@/infrastructure/db';
import { ForbiddenError } from '@/domain/shared/errors';
import { getUserRoleDeptIds } from '@/lib/auth/data-scope';

/**
 * 操作者的数据范围快照。
 *
 * 刻意用对象而非裸 `string[]` 包裹 `deptIds`：
 * 裸数组无法区分"尚未获取范围"与"范围为空"，而二者语义完全相反
 * （后者是"无权限"，前者是"未做检查"）。类型上强制调用方先取快照。
 */
export interface UserScope {
  /** 操作者可访问的部门 ID 列表（已含子树展开） */
  readonly deptIds: readonly string[];
}

/**
 * 获取操作者的数据范围快照（唯一合法来源）。
 *
 * **executor 决定快照的连接归属**：
 * - 写路径必须传 `tx`——快照与业务写入在同一事务上，消除"校验后、提交前
 *   操作者被降权"的 TOCTOU 窗口（H-ACL-002 / ADR-014）。
 * - 读路径传 `db`——只用于构造列表过滤条件。
 *
 * 这是 `requireDeptAccess(tx, ...)` 背后的同一个原语，只是把"取快照"与
 * "用快照"绑定在同一个调用栈上，使"事务外取快照、事务内使用"这种形状
 * 在结构上不可能出现。
 *
 * @param executor 事务句柄（写路径）或 db 直连（读路径）
 * @param operatorId 操作者用户 ID
 */
export async function resolveScope(
  executor: DbExecutor,
  operatorId: string,
): Promise<UserScope> {
  return { deptIds: await getUserRoleDeptIds(executor, operatorId) };
}

/**
 * 单个越界目标：目标部门 + 该目标专属的越界消息。
 *
 * 消息逐目标携带而非全局统一，因为同一次写操作可能有多个目标、
 * 且每个目标的越界语义不同（例如"无权操作该部门的用户"与
 * "无权将用户迁移至该部门"是两回事，审计需要能区分）。
 */
export interface AccessTarget {
  readonly deptId: string | null | undefined;
  readonly message: string;
}

/**
 * 纯判定：操作者范围是否覆盖目标部门（零 I/O，可穷举测试）。
 *
 * 规则（与 ADR-002 一致）：
 * - 范围为空 → 拒绝（无可见部门 = 无数据权限）
 * - 目标无部门（null/undefined）→ 拒绝（无法证明归属）
 * - 目标部门不在范围内 → 拒绝
 */
export function isWithinScope(scope: UserScope, targetDeptId: string | null | undefined): boolean {
  if (!targetDeptId) return false;
  if (scope.deptIds.length === 0) return false;
  return scope.deptIds.includes(targetDeptId);
}

/**
 * 断言全部目标都在操作者范围内，任一越界即抛 {@link ForbiddenError}
 * （经 `mapDomainError` 统一映射为 403）。
 *
 * 纯函数，不取快照——调用方必须先经 {@link resolveScope} 拿到 scope，
 * 且两者必须共享同一个 executor。这一约束由 {@link withScopedWrite} 保证。
 *
 * @throws ForbiddenError 任一目标越界
 */
export function assertWithinScope(scope: UserScope, targets: readonly AccessTarget[]): void {
  for (const target of targets) {
    if (!isWithinScope(scope, target.deptId)) {
      throw new ForbiddenError(target.message);
    }
  }
}
