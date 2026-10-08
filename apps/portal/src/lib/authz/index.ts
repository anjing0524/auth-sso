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
 * - **写路径**：只能经 {@link withScopedWrite}。它把事务、快照、守卫绑在一起，
 *   handler 只拿得到 `tx`。
 * - **读路径**：用 {@link resolveScope} 取范围，用 `scopeFilter`（待读路径迁移时
 *   加入本模块）构造过滤条件；空范围必须产生恒假条件，不得退化为"不过滤"。
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
  type ScopedWriteOptions,
  type ScopeTargets,
  type LoadedScopeGuardOptions,
} from './write';

export { scopeFilter, isScopeDenied } from './query';
