/**
 * 权限决策变更后的收敛动作 —— 顺序与配对的契约
 *
 * 本 module 存在的唯一理由，是把两个动作的**顺序**与**配对**从 6~8 个手写调用点
 * 收进 implementation。因此这里断言的正是那两件**别处看不见**的事：
 *
 * 1. 两个动作**总是成对**发生（此前漏掉任何一半都没有信号，四种形态并存）
 * 2. 顺序固定为**先撤销、后刷新**（撤销是安全相关动作，刷新是缓存性动作）
 *
 * 计数映射与"空输入不做任何 I/O"（该 module 的 interface 承诺）也一并钉住。
 *
 * @req NFR-SEC-14
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    revokeUsers: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
    refreshUsers: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
  },
}));

// @allow-module-mock @/lib/session/revoke input-fixture: 只提供"批量撤销结果"这一输入，用于观测配对与顺序；真实 Redis 撤销由 force-logout-revocation / oauth-revoke 覆盖
vi.mock(import('@/lib/session/revoke'), async (importOriginal): Promise<Partial<typeof sessionRevokeModule>> => {
  const actual = await importOriginal();
  return { ...actual, revokeUsersAccessByUserId: mocks.revokeUsers };
});

// @allow-module-mock @/lib/permissions input-fixture: 只提供"批量刷新结果"这一输入，用于观测配对与顺序；真实 DB+Redis 驱动的分级由 permission-cache-refresh-result 覆盖
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return { ...actual, refreshUsersPermissionCache: mocks.refreshUsers };
});

import {
  refreshAuthorizationCache,
  revokeAndRefreshAuthorization,
} from '@/lib/auth/authorization-effects';
import type * as sessionRevokeModule from '@/lib/session/revoke';
import type * as permissionsModule from '@/lib/permissions';

const revoke = mocks.revokeUsers;
const refresh = mocks.refreshUsers;

beforeEach(() => {
  vi.clearAllMocks();
  revoke.mockResolvedValue({ succeeded: 0, failed: 0 });
  refresh.mockResolvedValue({ succeeded: 0, failed: 0 });
});

describe('revokeAndRefreshAuthorization — 权限决策变更', () => {
  it('**两个动作成对发生**（漏掉一半此前没有任何信号）', async () => {
    await revokeAndRefreshAuthorization(['u1', 'u2']);

    expect(revoke).toHaveBeenCalledWith(['u1', 'u2']);
    expect(refresh).toHaveBeenCalledWith(['u1', 'u2']);
  });

  it('**顺序固定：先撤销（安全相关）后刷新（缓存性）**', async () => {
    await revokeAndRefreshAuthorization(['u1']);

    expect(revoke.mock.invocationCallOrder[0]!).toBeLessThan(refresh.mock.invocationCallOrder[0]!);
  });

  it('成败计数如实映射（撤销失败与缓存失败分别报出，不合并成一个数字）', async () => {
    revoke.mockResolvedValueOnce({ succeeded: 2, failed: 1 });
    refresh.mockResolvedValueOnce({ succeeded: 2, failed: 1 });

    await expect(revokeAndRefreshAuthorization(['u1', 'u2', 'u3'])).resolves.toEqual({
      users: 3,
      atRevokeSucceeded: 2,
      atRevokeFailed: 1,
      cacheFailed: 1,
    });
  });
});

describe('refreshAuthorizationCache — 不改变权限决策的变更', () => {
  it('只刷新，**不得**撤销（改名不应强制重登）', async () => {
    await refreshAuthorizationCache(['u1']);

    expect(refresh).toHaveBeenCalledWith(['u1']);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('只报缓存失败（不虚构撤销计数）', async () => {
    refresh.mockResolvedValueOnce({ succeeded: 1, failed: 1 });

    await expect(refreshAuthorizationCache(['u1', 'u2'])).resolves.toEqual({
      users: 2,
      cacheFailed: 1,
    });
  });
});

describe('空受影响集合', () => {
  it('两个动词都不做任何 I/O（不空转、不产生假日志）', async () => {
    await expect(revokeAndRefreshAuthorization([])).resolves.toEqual({
      users: 0, atRevokeSucceeded: 0, atRevokeFailed: 0, cacheFailed: 0,
    });
    await expect(refreshAuthorizationCache([])).resolves.toEqual({ users: 0, cacheFailed: 0 });

    expect(revoke).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
