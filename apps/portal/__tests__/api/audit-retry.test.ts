/**
 * `fireAndForgetWithRetry` —— 档③（运维观测）重试机制
 *
 * `lib/audit.ts` 的档③（`writeLoginLog` / `writeAccessLog`）声明"重试 3 次后
 * 放弃并记日志"（ADR-020）。此前**该机制零覆盖**：所有日志类测试都
 * `vi.mock('@/lib/audit')` 把整个模块替换掉，于是重试次数、退避、最终放弃
 * 这些行为从未被验证过——模块文档承诺的行为与实际实现之间没有任何约束。
 *
 * 本文件**不 mock 该模块**，直接测其重试原语。
 *
 * 测试用 mica 定时器跳过 1s + 2s 的真实退避等待。
 *
 * @req J-LOG-003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: { insert: vi.fn() },
}));

vi.mock('@/infrastructure/db', () => ({
  db: { insert: mocks.insert },
  schema: { auditLogs: {}, loginLogs: {}, accessLogs: {} },
}));

import { writeLoginLog, writeAccessLog } from '@/lib/audit';

/** 让 db.insert(...).values(...) 按给定顺序成功/失败 */
function insertSequence(outcomes: Array<'ok' | 'fail'>) {
  let i = 0;
  mocks.insert.mockImplementation(() => ({
    values: () => {
      const outcome = outcomes[Math.min(i, outcomes.length - 1)];
      i += 1;
      return outcome === 'ok' ? Promise.resolve(undefined) : Promise.reject(new Error('db down'));
    },
  }));
}

const LOGIN_PARAMS = {
  username: 'u1',
  eventType: 'LOGIN_SUCCESS' as const,
};

/**
 * 驱动一次 fire-and-forget：推进假定时器并让微任务队列排空。
 * 退避为 1s、2s，故需推进 3s 以上。
 */
async function drainTimers() {
  await vi.advanceTimersByTimeAsync(5000);
  // 再让队列中的微任务结算
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('档③ 重试机制（writeLoginLog / writeAccessLog 共用）', () => {
  it('首次成功 → 只写一次，不重试', async () => {
    insertSequence(['ok']);

    writeLoginLog(LOGIN_PARAMS);
    await drainTimers();

    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('前两次失败、第三次成功 → 共尝试 3 次', async () => {
    insertSequence(['fail', 'fail', 'ok']);

    writeLoginLog(LOGIN_PARAMS);
    await drainTimers();

    expect(mocks.insert).toHaveBeenCalledTimes(3);
  });

  it('**持续失败 → 恰好尝试 3 次后放弃**（不多不少，与文档一致）', async () => {
    insertSequence(['fail']);

    writeLoginLog(LOGIN_PARAMS);
    await drainTimers();

    expect(mocks.insert).toHaveBeenCalledTimes(3);
  });

  it('放弃后不再继续尝试（推进更长时间也不增加）', async () => {
    insertSequence(['fail']);

    writeLoginLog(LOGIN_PARAMS);
    await drainTimers();
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(mocks.insert).toHaveBeenCalledTimes(3);
  });

  it('退避发生在重试之间（1s + 2s），而非立即重试', async () => {
    insertSequence(['fail', 'fail', 'ok']);

    writeLoginLog(LOGIN_PARAMS);
    // 让首次尝试执行
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.insert).toHaveBeenCalledTimes(1);

    // 推进 1s → 第二次
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.insert).toHaveBeenCalledTimes(2);

    // 推进 2s → 第三次
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.insert).toHaveBeenCalledTimes(3);
  });

  it('writeAccessLog 走同一重试机制', async () => {
    insertSequence(['fail', 'ok']);

    writeAccessLog({
      username: 'u1',
      eventType: 'LOGIN_SUCCESS',
      method: 'GET',
      url: '/x',
      status: 200,
    } as never);
    await drainTimers();

    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });

  it('**永不抛出**：持续失败也不向外传播异常（档③与档①的关键区别）', async () => {
    insertSequence(['fail']);
    mocks.insert.mockImplementation(() => ({
      values: () => Promise.reject(new Error('db down')),
    }));

    // 同步调用本身不得抛
    expect(() => writeLoginLog(LOGIN_PARAMS)).not.toThrow();
    await drainTimers();
    // 异步失败也不得产生未处理的拒绝
    expect(mocks.insert).toHaveBeenCalled();
  });
});
