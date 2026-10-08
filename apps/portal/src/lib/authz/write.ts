import 'server-only';

/**
 * 数据范围写路径门面 — 事务、快照、守卫三件事不可分开
 *
 * 写路径的数据范围校验有一个必须同时满足的不变量：
 * **操作者范围快照与业务写入必须源自同一执行器（同一事务）**。
 *
 * 违反它的代价是 TOCTOU：操作者在快照获取之后、写入提交之前被降权，
 * 越权写入仍然成立（H-ACL-002）。该缺陷曾在 9 条写路径中的 8 条存在，
 * 且形态是"事务内写入 + 事务外取快照"——因为没有任何东西强制两者绑定。
 *
 * {@link withScopedWrite} 把三者收进一个包装器：
 * 快照在事务内获取、守卫在事务内断言、handler 只拿得到 `tx`（拿不到 `db`）。
 * 于是"事务外快照"这一形状在类型与结构上都不可能再写出来。
 *
 * @module lib/authz/write
 */
import { db } from '@/infrastructure/db';
import type { DbTxHandle } from '@/infrastructure/db';
import { resolveScope, assertWithinScope, type AccessTarget, type UserScope } from './data-scope';

/**
 * 守卫目标来源：
 * - 数组：目标部门已知（例如路由参数直接给出的部门 ID）
 * - 函数：目标需要在事务内先加载才能知道其部门（例如按 id 查用户）
 *
 * 函数形式接收 `tx`，因此"加载目标"与"断言范围"天然在同一事务内。
 * 若目标不存在，守卫无法表达 404 —— 由 handler 在事务内自行加载并返回对应错误。
 */
export type ScopeTargets =
  | readonly AccessTarget[]
  | ((tx: DbTxHandle) => Promise<readonly AccessTarget[]>);

export interface ScopedWriteOptions {
  /** 操作者用户 ID（通常由 withPermission 提供） */
  readonly operatorId: string;
  /** 越界目标，或"在事务内加载目标"的函数 */
  readonly targets: ScopeTargets;
  /**
   * 守卫**之前**的领域校验（同一事务内）。
   *
   * 用于"目标必须存在/必须处于某状态"这类检查，使 404/422 不被
   * 越界的 403 抢答。顺序有意义：`preflight`（存在性/状态）→
   * 范围快照 → 断言 → handler。若把存在性校验放进 handler，
   * 一个不存在的目标会返回 403 而不是 404 —— 把"不存在"退化成"无权限"。
   */
  readonly preflight?: (tx: DbTxHandle) => Promise<void>;
}

/**
 * 在单个事务内完成「取操作者范围快照 → 断言目标在范围内 → 执行业务写入」。
 *
 * handler 只接受 {@link DbTxHandle}：写路径物理上无法误用事务外的 `db`
 * （Drizzle 的 `db` 与 `tx` 是两个不同连接，用 `db` 的写入立即提交、
 * 不随本事务回滚）。
 *
 * 越界时抛出 `ForbiddenError`，由调用链上的 `withPermission` /
 * `mapDomainError` 统一映射为 403；事务随之回滚，不会留下部分写入。
 *
 * @param options.operatorId 操作者用户 ID
 * @param options.targets    目标部门（数组）或事务内加载目标的函数
 * @param handler            业务写入，只接收事务句柄
 */
export async function withScopedWrite<T>(
  options: ScopedWriteOptions,
  handler: (tx: DbTxHandle) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // 领域校验先行：存在性/状态问题不应被越界的 403 抢答
    if (options.preflight) {
      await options.preflight(tx);
    }
    // 快照取在事务内：与后续写入共享同一事务的连接与可见性
    const scope = await resolveScope(tx, options.operatorId);
    const targets = typeof options.targets === 'function'
      ? await options.targets(tx)
      : options.targets;
    assertWithinScope(scope, targets);
    return handler(tx);
  });
}

export interface LoadedScopeGuardOptions<TRow> {
  /** 操作者用户 ID */
  readonly operatorId: string;
  /** 在事务内加载目标行；返回 null/undefined 表示不存在 */
  readonly load: (tx: DbTxHandle) => Promise<TRow | null | undefined>;
  /** 从已加载的行取目标部门 */
  readonly deptOf: (row: TRow) => string | null | undefined;
  /** 越界消息（按目标语义定制，用于审计区分） */
  readonly message: string;
  /**
   * 同一事务内解析出的**额外**目标（如"拟迁入的部门"）。
   *
   * 提供它的理由不是便利，而是避免调用方在 handler 里再次 `resolveScope(tx, …)`
   * ——那会读同一个快照两遍，且给了"第二次快照可能不同"的错觉。
   * 接收 scope 而非 tx：额外目标往往是入参（无需查库），不需要新的 I/O。
   */
  readonly extraTargets?: (scope: UserScope) => readonly AccessTarget[];
  /** 行不存在时抛出 —— 通常传 `new EntityNotFoundError('User', id)` */
  readonly notFound: () => Error;
}

/**
 * 事务内的「加载目标行 → 不存在则 404 → 断言在操作者数据范围内 → 返回该行」。
 *
 * ## 为什么需要它（而不是直接用 {@link withScopedWrite}）
 *
 * 顺序是**有意义**的：必须**先判定存在、再判定授权**。
 * {@link withScopedWrite} 的守卫在 handler 之前运行，若直接套用，
 * 一个不存在的目标会返回 403 而非 404 —— 把"不存在"退化成"无权限"，
 * 既是契约改变，也让调用方无法区分。故此处保持 load → 404 → guard 的顺序。
 *
 * ## 为什么需要它（而不是继续手写）
 *
 * 「加载行 / 抛 EntityNotFoundError / requireDeptAccess」这三行在
 * users、roles、departments 三个 actions 文件里重复了 14 次。
 * 手写时两步都可能漏：漏第二步是错错误码，**漏第三步是越权**——
 * 把这组必须一起出现的三步收成一个调用，漏掉不再可能。
 *
 * @returns 已加载且在范围内的目标行（同一事务内可见）
 * @throws notFound() 行不存在时；ForbiddenError 越界时
 */
export async function withScopedRow<T, TRow>(
  options: LoadedScopeGuardOptions<TRow>,
  handler: (tx: DbTxHandle, row: TRow) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const row = await options.load(tx);
    if (row === null || row === undefined) {
      throw options.notFound();
    }
    const scope = await resolveScope(tx, options.operatorId);
    assertWithinScope(scope, [
      { deptId: options.deptOf(row), message: options.message },
      ...(options.extraTargets?.(scope) ?? []),
    ]);
    return handler(tx, row);
  });
}
