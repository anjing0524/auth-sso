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
import { resolveScope, assertWithinScope, type AccessTarget } from './data-scope';

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
    // 快照取在事务内：与后续写入共享同一事务的连接与可见性
    const scope = await resolveScope(tx, options.operatorId);
    const targets = typeof options.targets === 'function'
      ? await options.targets(tx)
      : options.targets;
    assertWithinScope(scope, targets);
    return handler(tx);
  });
}
