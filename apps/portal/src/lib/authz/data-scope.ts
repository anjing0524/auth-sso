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
 * 子树展开（原 `lib/auth/data-scope.ts` 的 `getUserRoleDeptIds`）已**收进本模块作私有
 * implementation**：它只被 {@link resolveScope} 调用，暴露出去就又是"两种形状"的入口。
 * 零调用方的 `canAccessDept` 随之删除——它的判据与 {@link isWithinScope} 逐字相同，
 * 而后者带 `UserScope` 形状（能区分"未取快照"与"范围为空"）。
 *
 * @module lib/authz/data-scope
 */
import { eq, like, or } from 'drizzle-orm';
import type { DbExecutor } from '@/infrastructure/db';
import { schema } from '@/infrastructure/db';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import { ForbiddenError } from '@/domain/shared/errors';

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
 * 计算操作者可见部门集合（含子树展开）—— **私有 implementation**。
 *
 * 两步逻辑：
 * 1. 取用户全部 **ACTIVE** 角色的 `dept_id`（与 `getUserPermissionContext` 同一口径）
 * 2. 对每个 `dept_id` 用物化路径 `ancestors` 展开子树，去重返回
 *
 * 首参 executor 决定连接归属：读路径传 `db`；事务内写守卫传 `tx`。
 *
 * **不要把「同一事务」当成「同一快照」**：PostgreSQL 默认 READ COMMITTED 下同一事务内
 * 每条语句各取新快照，因此门面只是把「校验后、提交前操作者被降权」的窗口**收窄**到
 * 同一事务的语句之间，**并未消除**；真正的强保证需要对操作者授权行加锁或串行化
 * （ADR-028 / ADR-014「代价」节）。
 *
 * ## 子树谓词必须逐段判定（两次踩坑的教训）
 *
 * `ancestors` 是**完整祖先链**（root 在前、`/` 分隔、不含自身）——见
 * `domain/department.ts` 的 `computeAncestorPrefix`：根 `null`、一级子部门 `= 根ID`、
 * 二级 `= 根ID/一级ID`。因此"deptId 是否在祖先链上"要**逐段**判定，共五条分支：
 *
 * | 分支 | 命中 |
 * |---|---|
 * | `id = deptId` | 部门自身 |
 * | `ancestors = deptId` | deptId 在链首（其直接子部门，如 ROOT → `ROOT`） |
 * | `ancestors LIKE deptId/%` | deptId 在链首的更深后代（ROOT → `ROOT/TECH`） |
 * | `ancestors LIKE %/deptId` | deptId 在链尾（其直接子部门，如 TECH → `ROOT/TECH`） |
 * | `ancestors LIKE %/deptId/%` | deptId 在链中（孙子及更深，TECH → `ROOT/TECH/FE`） |
 *
 * 历史上两次都是"少一条分支，而测试把缺失写成期望"：
 * 1. 只有第 3 条时，根部门的**一级**子部门（`ancestors = ROOT`，无 `/`）被整体漏掉
 *    （ADR-014 记录的那次）；
 * 2. 补上第 2 条后修好了**根角色**，但**非根角色仍漏掉全部深度 ≥ 2 的后代**——
 *    `FE` 的 `ancestors` 是 `ROOT/TECH`，既不等于 `TECH` 也不以 `TECH/` 开头，
 *    于是"技术部管理员看不见前端组/后端组的用户"；而当时三条断言
 *    （`ADMIN → {TECH}`、`MULTI_ROLE → {TECH, MKT}`、"FE/BE 不在 TECH 角色管辖范围"）
 *    把这个缺陷钉成了期望值。
 *
 * **方向性说明**：漏判是 fail-closed（少看见数据），不构成越权；但它是真实的功能缺陷。
 * 新增分支只会**扩大**范围、不会缩小，故对既有范围内的对象无影响。
 *
 * @param executor db 直连或事务句柄
 * @param operatorId 操作者用户 ID
 * @returns 部门 ID 列表（已去重、已展开子树）；无角色时为空数组
 */
async function expandRoleDeptSubtrees(
  executor: DbExecutor,
  operatorId: string,
): Promise<string[]> {
  const user = await executor.query.users.findFirst({
    where: eq(schema.users.id, operatorId),
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

  // 只取 ACTIVE 角色的 dept_id，与 getUserPermissionContext 保持一致
  const roleDeptIds = Array.from(
    new Set(
      user.userRoles
        .filter(ur => ur.role !== null && ur.role.status === ENTITY_ACTIVE)
        .map(ur => ur.role!.deptId)
        .filter((id): id is string => !!id),
    ),
  );

  if (roleDeptIds.length === 0) return [];

  // 单次批量 SQL 替代 N+1：对每个角色 deptId 展开其子树（五条分支见函数文档）
  const conditions = roleDeptIds.flatMap((deptId): ReturnType<typeof or>[] => [
    // 部门自身
    eq(schema.departments.id, deptId),
    // deptId 在祖先链链首：其直接子部门（ancestors 恰等于 deptId）
    eq(schema.departments.ancestors, deptId),
    // deptId 在祖先链链首：更深后代（ancestors 以 `deptId/` 开头）
    like(schema.departments.ancestors, `${deptId}/%`),
    // deptId 在祖先链链尾：其直接子部门（ancestors 以 `/deptId` 结尾）
    like(schema.departments.ancestors, `%/${deptId}`),
    // deptId 在祖先链链中：孙子及更深后代（`…/deptId/…`）
    like(schema.departments.ancestors, `%/${deptId}/%`),
  ]);
  const result = await executor
    .select({ id: schema.departments.id })
    .from(schema.departments)
    .where(or(...conditions));
  return Array.from(new Set(result.map((r) => r.id)));
}

/**
 * 获取操作者的数据范围快照（唯一合法来源）。
 *
 * **executor 决定快照的连接归属**：
 * - 写路径必须传 `tx`——快照与业务写入在同一事务上，把「校验后、提交前操作者被降权」
 *   的窗口**收窄**到同一事务的语句之间（**不等于消除**；强保证需加锁/串行化，
 *   见 ADR-028 / ADR-014 残余风险）。
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
  return { deptIds: await expandRoleDeptSubtrees(executor, operatorId) };
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
 * **空目标集合不是「无需校验」，而是「没有守卫」**：直接 fail-close 拒绝，
 * 避免 `targets: []` 把 PEP 静默关闭（ADR-028）。非空约束同时体现在
 * `ScopeTargets` 类型与 {@link withScopedWrite} 上。
 *
 * 纯函数，不取快照——调用方必须先经 {@link resolveScope} 拿到 scope，
 * 且两者必须共享同一个 executor。这一约束由 {@link withScopedWrite} 保证。
 *
 * @throws ForbiddenError 目标集合为空，或任一目标越界
 */
export function assertWithinScope(scope: UserScope, targets: readonly AccessTarget[]): void {
  if (targets.length === 0) {
    throw new ForbiddenError('数据范围守卫未提供任何目标：空目标等于跳过校验');
  }
  for (const target of targets) {
    if (!isWithinScope(scope, target.deptId)) {
      throw new ForbiddenError(target.message);
    }
  }
}
