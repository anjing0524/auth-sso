/**
 * 数据范围授权门面 (Data Scope Authorization Facade)
 *
 * OBAC 数据范围（ADR-002）授权的唯一公开入口。设计依据见 **ADR-014**。
 *
 * ## 为什么需要门面
 *
 * 范围过滤与越界守卫曾以两种形状散落在 28 个调用点：`requireDeptAccess(tx, ...)`
 * 与手写 `getUserRoleDeptIds + canAccessDept`。结果是同一项目内两种正确性
 * （Server Action 侧 16/16 正确，REST 侧 8/13 因事务外取快照而存在 TOCTOU）。
 * 把 `getUserRoleDeptIds` / `canAccessDept` 留在公开面上，等于把
 * "快照必须与使用源自同一执行器"这个不变量交给每个调用点自行维护。
 *
 * ## 使用约定
 *
 * - **写路径**：有具体目标部门时经 {@link withScopedWrite}（`targets` 类型上非空）；
 *   需要「加载行 → 404 → 断言」时经 {@link withScopedRow}；全局资源写（根部门、
 *   历史遗留的无部门用户）经具名的 {@link withGlobalWrite}。空 targets 不再可表达
 *   （ADR-028）——「没有目标」与「跳过校验」必须分开。
 * - **读路径**：用 {@link resolveScope} 取范围（必须在 `"use cache"` 作用域**外**，
 *   Cache Components 要求），用 {@link scopeFilter} 构造过滤条件——它**已经在本门面里**
 *   （此文案原写"待读路径迁移时加入"，早已过期；2026-10-15 巡检候选 3 更正）。
 *   空范围必须产生恒假条件，不得退化为"不过滤"；"取了范围却不用 / 收了范围却不用"
 *   由 `__tests__/api/read-scope-usage-guard.test.ts` 机械兜住。
 * - **纯判定**：{@link isWithinScope} / {@link assertWithinScope} 零 I/O，
 *   仅在已有 scope 的前提下使用；不要用它们绕过门面自行取快照。
 *
 * @module lib/authz
 */
export {
  resolveScope,
  isWithinScope,
  assertWithinScope,
  type UserScope,
  type AccessTarget,
} from './data-scope';

export {
  withScopedWrite,
  withScopedRow,
  withGlobalWrite,
  type ScopedWriteOptions,
  type ScopeTargets,
  type NonEmptyTargets,
  type LoadedScopeGuardOptions,
  type GlobalWriteOptions,
} from './write';

export { scopeFilter, isScopeDenied } from './query';

export { loadOperatorAuthorization, targetHasAdminRole, assertCanMutateAdminTarget, type OperatorAuthorization } from './operator';
