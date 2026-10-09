/**
 * 批量刷新权限缓存的**结果可判别性**（mock Redis）
 *
 * ## 为什么需要它
 *
 * `refreshUsersPermissionCache` 用于"角色/权限/部门变更后立即同步一批用户的缓存"。
 * 它通过 `settleUserBatches` 统计失败：
 *
 * ```ts
 * failed += results.filter((r) => r.status === 'rejected').length;
 * ```
 *
 * 但它调用的 `refreshUserPermissionCache` **内部整体 try/catch、0 个 throw 出口**
 * （出错只记日志），因此**永不 reject** ⇒ `failed` **恒为 0**，
 * `Refreshed cache for N users` 的日志恒打印、失败数恒为 0。
 *
 * 这与本会话已修的 `revokeUsersAccessByUserId`、`revokeAllRefreshTokens` 是
 * **同一形态的第三次出现**：把"永不失败的调用"当作失败信号。
 *
 * ## 为什么此前隐形
 *
 * 现有 4 个 permission 相关测试都 `vi.mock('@/lib/permissions')` 整体顶掉该模块，
 * 因此**没有任何测试观察它的真实返回值**。本文件用真实实现 + mock Redis。
 *
 * @req H-PERM-004, H-SESS-004
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    /** del 的替身：决定缓存清除是否成功（失败即模拟 Redis 故障） */
    mockDel: vi.fn(async (..._keys: string[]) => 1),
    /** 权限上下文查询：失败即模拟 DB/解析故障 */
    mockGetContext: vi.fn(async (_userId: string) => ({ kind: 'ok', context: { roles: [], permissions: [], deptIds: [] } })),
  },
}));

vi.mock('@/infrastructure/redis', () => ({
  getRedis: () => ({
    del: mocks.mockDel,
    get: vi.fn(async () => null),
    setex: vi.fn(async () => 'OK'),
  }),
}));

vi.mock('@/infrastructure/db', () => ({
  db: {},
  schema: {},
}));

import { refreshUsersPermissionCache } from '@/lib/permissions';

const USER_A = '00000000-0000-4000-8000-000000000101';
const USER_B = '00000000-0000-4000-8000-000000000201';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockDel.mockResolvedValue(1);
});

describe('refreshUsersPermissionCache — 成败必须可判别', () => {
  it('全部成功 → succeeded 等于用户数，failed 为 0', async () => {
    const result = await refreshUsersPermissionCache([USER_A, USER_B]);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('**全部失败 → failed 必须等于用户数**（旧实现 rejected 恒为 0，此断言会失败）', async () => {
    mocks.mockDel.mockRejectedValue(new Error('redis unavailable'));

    const result = await refreshUsersPermissionCache([USER_A, USER_B]);

    // 旧实现：refreshUserPermissionCache 吞掉异常 ⇒ allSettled 全 fulfilled
    // ⇒ failed 恒为 0，日志把"全部失败"报成"成功 N 个"
    expect(result.failed).toBe(2);
    expect(result.succeeded).toBe(0);
  });

  it('空数组 → 全 0，且不触碰 Redis', async () => {
    const result = await refreshUsersPermissionCache([]);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(mocks.mockDel).not.toHaveBeenCalled();
  });
});
