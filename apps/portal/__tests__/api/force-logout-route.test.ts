/**
 * 强制下线端点的响应契约（mock 编排依赖）
 *
 * ## 为什么需要它
 *
 * `POST /api/users/[id]/force-logout` 的响应承诺告知管理员「本次撤销了多少个
 * Access Token JTI」。但实现里存在一次**重复撤销**：
 *
 * 1. `revokeAllRefreshTokens(userId)` 内部已调用 `revokeUserAccessByUserId`
 *    （双层撤销闭环）
 * 2. 路由随后**又调用一次** `revokeUserAccessByUserId`，并把它当作计数来源
 *
 * 而 `revokeUserAccessByUserId` 是**幂等**的——它读完 `user_jti` 映射后
 * 执行 `pipeline.del(key)` 消费掉该映射。故第二次调用必然拿到空映射、返回 0。
 *
 * 结果：`revokedJtiCount` 恒为 0，响应里的「已撤销 N 个 Access Token JTI」
 * 永远显示 0，与实际撤销数量无关（N 个 AT 确实被撤销了，只是数字报错）。
 *
 * 本文件以**响应契约**为接缝锁住这个数字的真实性。
 *
 * @req H-SESS-004, H-SESS-006
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedAdminUser } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: {
    /** 撤销该用户全部 AT 的 jti，返回实际撤销数量 */
    mockRevokeUserAccess: vi.fn(async () => 0),
    mockClearPermCache: vi.fn(async () => {}),
  },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/lib/session/revoke', () => ({
  revokeUserAccessByUserId: mocks.mockRevokeUserAccess,
  isJtiRevoked: vi.fn(async () => false),
  trackUserJti: vi.fn(async () => {}),
  revokeJti: vi.fn(async () => {}),
  revokeUserToken: vi.fn(async () => {}),
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: vi.fn(async () => ({ roles: [], permissions: [], deptIds: [] })),
  cacheUserPermissionContext: vi.fn(async () => {}),
  clearUserPermissionCache: mocks.mockClearPermCache,
}));

// 权限门面与数据范围守卫：本文件测的是响应契约，非鉴权（后者另有覆盖）
vi.mock('@/lib/auth', () => ({
  withPermission: (_opts: unknown, handler: (adminUserId: string) => unknown) =>
    handler('00000000-0000-4000-8000-000000000101'),
}));

vi.mock('@/lib/authz', () => ({
  withScopedWrite: async (_opts: unknown, write: () => Promise<unknown>) => write(),
}));

vi.mock('@/lib/cache-invalidation', () => ({ invalidateResource: vi.fn() }));

import { POST } from '@/app/api/users/[id]/force-logout/route';
import { NextRequest } from 'next/server';

const td = createTestDbHandle();
tdHolder.current = td;

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
  });
});

function forceLogoutRequest(): NextRequest {
  return new NextRequest(`http://localhost:4100/api/users/${ADMIN_ID}/force-logout`, {
    method: 'POST',
  });
}

async function callRoute(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await POST(forceLogoutRequest(), { params: Promise.resolve({ id: ADMIN_ID }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/users/[id]/force-logout — 响应契约', () => {
  it('**响应中的 revokedJtiCount 必须等于实际撤销的 JTI 数量**', async () => {
    // 该用户当时持有 3 个未过期 AT
    mocks.mockRevokeUserAccess.mockResolvedValue(3);

    const { body } = await callRoute();

    // 本用例锁**响应形状**（数量如实出现在 body 与 message 中）；
    // "不得重复调用导致计数归零"由下一条用例负责——用固定返回值的 mock
    // 无法区分调用次数，故两者分工明确。
    expect(body['revokedJtiCount']).toBe(3);
    expect(String(body['message'])).toContain('3');
  });

  it('**jti 撤销只执行一次**（重复调用是幂等空转，第二次必然返回 0 使计数失真）', async () => {
    mocks.mockRevokeUserAccess.mockResolvedValue(2);

    await callRoute();

    // 编排层调用一次即可；路由额外再调一次会拿到 0
    expect(mocks.mockRevokeUserAccess).toHaveBeenCalledTimes(1);
  });

  it('撤销 0 个 JTI 时如实报告 0（不得伪造数字）', async () => {
    mocks.mockRevokeUserAccess.mockResolvedValue(0);

    const { body } = await callRoute();

    expect(body['revokedJtiCount']).toBe(0);
  });

  it('用户不存在 → 404，且不执行任何撤销', async () => {
    const res = await POST(forceLogoutRequest(), {
      params: Promise.resolve({ id: '00000000-0000-4000-8000-00000000dead' }),
    });

    expect(res.status).toBe(404);
    expect(mocks.mockRevokeUserAccess).not.toHaveBeenCalled();
  });
});
