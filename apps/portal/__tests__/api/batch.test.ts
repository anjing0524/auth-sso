/**
 * 批量执行原语的契约
 *
 * 本原语存在的唯一理由，是让"成败"不再依赖**被调方自报的布尔值**——那个值可以是假话
 * （本仓同一个 bug 被独立修过三次，第三次的根因正是自报的 `ok` 与实际不符）。
 * 因此这里钉住的正是那条判据：**`operation` 抛出即失败**。
 *
 * 同时钉住分批语义（批内并发、批间串行、跨批不丢计数）——它是两个消费方共同依赖的性质。
 *
 * @req NFR-SEC-14
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { settleInBatches } from '@/lib/batch';

describe('settleInBatches — 成败判据', () => {
  it('**抛出的项计为失败，未抛出的计为成功**（唯一判据，不读任何自报标记）', async () => {
    const items = ['a', 'b', 'c', 'd'];

    const result = await settleInBatches(items, async (item) => {
      if (item === 'b' || item === 'd') throw new Error('boom');
    });

    expect(result).toEqual({ succeeded: 2, failed: 2 });
  });

  it('**单项失败不影响其他项**（逐项隔离，全部项都被尝试）', async () => {
    const seen: string[] = [];

    const result = await settleInBatches(['a', 'b', 'c'], async (item) => {
      seen.push(item);
      if (item === 'a') throw new Error('boom');
    });

    expect(seen.sort()).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ succeeded: 2, failed: 1 });
  });

  it('**全部抛出 → failed 等于项数**（正是当年"恒为 0"的那个数字）', async () => {
    const result = await settleInBatches(['a', 'b', 'c'], async () => {
      throw new Error('boom');
    });

    expect(result).toEqual({ succeeded: 0, failed: 3 });
  });

  it('空输入 → 全 0，且完全不调用 operation', async () => {
    const operation = vi.fn(async () => {});

    await expect(settleInBatches([], operation)).resolves.toEqual({ succeeded: 0, failed: 0 });
    expect(operation).not.toHaveBeenCalled();
  });
});

describe('settleInBatches — 分批语义', () => {
  it('跨批不丢计数（120 项 > 批大小 50，全部逐项处理）', async () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const visited: number[] = [];

    const result = await settleInBatches(items, async (n) => {
      visited.push(n);
      if (n % 10 === 0) throw new Error('boom');   // 12 项失败
    });

    expect(visited).toHaveLength(120);
    expect(result).toEqual({ succeeded: 108, failed: 12 });
  });

  it('批内并发、并发度不超过批大小', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await settleInBatches(Array.from({ length: 120 }, (_, i) => i), async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });

    expect(maxInFlight).toBeGreaterThan(1);    // 确实并发
    expect(maxInFlight).toBeLessThanOrEqual(50); // 但不越过批大小
  });
});
