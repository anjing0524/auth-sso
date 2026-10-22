/**
 * 批量撤销 Access Token 的**结果可判别性**（mock Redis）
 *
 * ## 为什么需要它
 *
 * `revokeUsersAccessByUserId` 用于"权限/角色变更后强制一批用户重登"——这是最需要
 * 审计留痕的一类操作。它的实现按 `Promise.allSettled` 的 `rejected` 统计失败：
 *
 * ```ts
 * failed += results.filter((r) => r.status === 'rejected').length;
 * ```
 *
 * 但它调用的 `revokeUserAccessByUserId` **自身整体 try/catch、永不 reject**
 * （内部出错只记日志并 `return 0`）。因此 `failed` **恒为 0**：
 * "批量撤销 N 个用户成功"的日志恒打印，失败告警**永不触发**。
 *
 * 这与已修的 `revokeAllRefreshTokens.revokedJtiCount` 是**同一形态的缺陷**——
 * 把"永不失败的调用"当作失败信号。区别只是后者泄露到 API 响应里，
 * 前者只污染审计日志。
 *
 * ## 接缝
 *
 * 断言 `revokeUsersAccessByUserId` 返回的**真实成败计数**。此前它返回 `void`，
 * 调用方无从判别，测试也无从断言——所以这个缺陷在测试里隐形。
 *
 * @req H-SESS-004, H-SESS-006
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    /** hgetall 的替身：决定每个用户是"有 JTI 可撤"还是"Redis 出错" */
    mockHgetall: vi.fn<(key: string) => Promise<Record<string, string>>>(),
    mockSetex: vi.fn(async () => 'OK'),
    mockDel: vi.fn(async () => 1),
  },
}));

vi.mock('@/infrastructure/redis', () => ({
  getRedis: () => ({
    hgetall: mocks.mockHgetall,
    pipeline: () => {
      const chain = {
        setex: (_key: string, _ttl: number, _value: string) => {
          void mocks.mockSetex();
          return chain;
        },
        del: () => chain,
        exec: async () => [],
      };
      return chain;
    },
  }),
}));

import { revokeUsersAccessByUserId } from '@/lib/session/revoke';

const USER_A = '00000000-0000-4000-8000-000000000101';
const USER_B = '00000000-0000-4000-8000-000000000201';

/** 该用户有一个未过期 AT 的 jti 映射 */
function healthyJtiMap(): Record<string, string> {
  return { jti_one: String(Math.floor(Date.now() / 1000) + 3600) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockHgetall.mockResolvedValue(healthyJtiMap());
});

describe('revokeUsersAccessByUserId — 成败必须可判别', () => {
  it('全部成功 → succeeded 等于用户数，failed 为 0', async () => {
    const result = await revokeUsersAccessByUserId([USER_A, USER_B]);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('**全部失败 → failed 必须等于用户数**（旧实现的 rejected 恒为 0，此断言会失败）', async () => {
    mocks.mockHgetall.mockRejectedValue(new Error('redis unavailable'));

    const result = await revokeUsersAccessByUserId([USER_A, USER_B]);

    // 旧实现：`revokeUserAccessByUserId` 吞掉异常返回 0，allSettled 全部 fulfilled
    // ⇒ failed 恒为 0，"成功"日志恒打印。撤销实际没发生，却报成功。
    expect(result.failed).toBe(2);
    expect(result.succeeded).toBe(0);
  });

  it('部分失败 → 计数如实反映（不得混同为全成或全败）', async () => {
    let call = 0;
    mocks.mockHgetall.mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new Error('redis unavailable');
      return healthyJtiMap();
    });

    const result = await revokeUsersAccessByUserId([USER_A, USER_B]);

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it('空数组 → 全 0，且不触碰 Redis', async () => {
    const result = await revokeUsersAccessByUserId([]);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(mocks.mockHgetall).not.toHaveBeenCalled();
  });

  it('超过批大小（50）仍逐一统计，不因分批而丢失失败', async () => {
    mocks.mockHgetall.mockRejectedValue(new Error('redis unavailable'));
    const users = Array.from({ length: 120 }, (_, i) => `user-${i}`);

    const result = await revokeUsersAccessByUserId(users);

    expect(result.failed).toBe(120);
    expect(result.succeeded).toBe(0);
  });
});
