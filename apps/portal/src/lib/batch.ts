import 'server-only';

/**
 * 批量执行原语 —— 逐项隔离失败并如实统计成败
 *
 * ## 为什么需要它
 *
 * 「按 50 一批并发执行、单项失败不影响其他项、最后报告成功/失败计数」这段逻辑在本仓
 * 被**抄了两遍**（`lib/permissions.ts` 与 `lib/session/revoke.ts`），且两份的成败极性相反
 * （`{ok}` vs `{revoked, failed}`）、结果类型各起一个名字。
 *
 * 后果不是"重复"，而是**同一个 bug 被独立修了三次**（`a7fa3cb` / `ad530d6` / `7d38152`）：
 * 三处都曾用 `Promise.allSettled` 的 `rejected` 计数，而被调方**永不 reject**，
 * 于是 `failed` 恒为 0 —— "全部失败"照样打印"批量成功"。第三次修复才发现根因更深：
 * **被调方自报的 `ok` 布尔值可以是假话**，聚合侧再正确也无用。
 *
 * ## 成败判据是唯一的：`operation` 抛出即失败
 *
 * 因此本原语的 interface 刻意**不接受任何"成败标记"**：`operation` 返回 `Promise<void>`，
 * 失败必须经由**抛出**表达。抛出是语言自身的机制，不能被算错；而自报的布尔值能。
 *
 * 两个约束随之落到调用方（都写在实现里，不是纪律）：
 * - **每项的业务失败判据必须收敛到一处**：被调方的判别式结果（如 `{ ok: false }`、
 *   `{ failed: true }`）由一层薄 adapter 翻译为抛出。
 * - **失败日志由 operation 自己记**：本原语没有领域知识，不替它猜原因。
 *
 * @module lib/batch
 */

/** 单批并发度：吸收重试风暴，又不至于把 10k 用户一次性压给 Redis */
const BATCH_SIZE = 50;

/** 批量执行的成败计数 */
export interface BatchOutcome {
  /** 未抛出的项数 */
  readonly succeeded: number;
  /** 抛出（被逐项隔离）的项数 */
  readonly failed: number;
}

/**
 * 按 {@link BATCH_SIZE} 分批并发执行 `operation`，逐项隔离失败，统计成败。
 *
 * 批内并发、批间串行：任一项抛出只影响该项的计数，其余项照常执行。
 * 空输入返回 `{ succeeded: 0, failed: 0 }`，不产生任何 I/O。
 *
 * @param items 待处理项（顺序即分批顺序）
 * @param operation 单项操作；**抛出即计为失败**
 */
export async function settleInBatches<T>(
  items: readonly T[],
  operation: (item: T) => Promise<void>,
): Promise<BatchOutcome> {
  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    const results = await Promise.all(
      items.slice(index, index + BATCH_SIZE).map(async (item) => {
        try {
          await operation(item);
          return true;
        } catch {
          // 刻意不留日志：失败原因由 operation 在发生处记录（它才有领域知识）
          return false;
        }
      }),
    );
    for (const ok of results) {
      if (ok) succeeded += 1;
      else failed += 1;
    }
  }

  return { succeeded, failed };
}
